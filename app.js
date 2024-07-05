#!/usr/bin/env node
'use strict';

require('dotenv').config(); // Load environment variables from .env file if used
const express = require('express');
const formidable = require('formidable');
const { join, basename } = require('path');
const fs = require('fs-extra');
const morgan = require('morgan');
const asyncHandler = require('express-async-handler');
const archiver = require('archiver');
const pMap = require('p-map');
const os = require('os');
const flatMap = require('lodash/flatMap');
const contentDisposition = require('content-disposition');
const { createProxyMiddleware } = require('http-proxy-middleware');
const qrcode = require('qrcode-terminal');
const clipboardy = require('clipboardy');
const bodyParser = require('body-parser');
const filenamify = require('filenamify');
const util = require('util');
const stream = require('stream');
const parseRange = require('range-parser');
const session = require('express-session');

const mysql = require('mysql2');
const crypto = require('crypto');

const pipeline = util.promisify(stream.pipeline);

const maxFields = 1000;
const debug = false;

const isDirectory = async (filePath) => (await fs.lstat(filePath)).isDirectory();

const isPrivateIP = (ip) => {
  const parts = ip.split('.').map(Number);
  return (parts[0] === 10) ||
         (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
         (parts[0] === 192 && parts[1] === 168);
};

const generateRandomSecret = () => {
  return crypto.randomBytes(32).toString('hex'); // 32 bytes (256 bits) of random data
};

module.exports = ({ sharedPath: sharedPathIn, port, maxUploadSize, zipCompressionLevel, devMode }) => {
  // console.log({ sharedPath: sharedPathIn, port, maxUploadSize, zipCompressionLevel });
  const sharedPath = sharedPathIn || process.cwd();

  function getFilePath(relPath) {
    if (relPath == null) return sharedPath;
    return join(sharedPath, join('/', relPath));
  }

  const app = express();
  app.use(express.json()); // Middleware to parse JSON bodies

  if (debug) app.use(morgan('dev'));

  const usingHttps = process.env.USING_HTTPS === 'true';
  const sessionLifetimeInHours = parseInt(process.env.SESSION_LIFETIME_IN_HOURS, 10);

  app.use(session({
    secret: generateRandomSecret(), // Change this to a secure random key
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: usingHttps, // Set to true if using HTTPS
      maxAge: 60 * 60 * 1000 * sessionLifetimeInHours, // Session expires after 8 hour of inactivity
    }
  }));

  // NOTE: Must support non latin characters
  app.post('/api/upload', asyncHandler(async (req, res) => {
    if (req.session.isLoggedIn == undefinedd || !req.session.isLoggedIn)
      return res.status(401).json({ error: 'User not logged in' });
    if(req.session.UploadAllowed == undefined || !req.session.UploadAllowed)
      return res.status(403).json({ error: 'Permission denied' });

    // parse a file upload
    const form = new formidable({
      multiples: true,
      keepExtensions: true,
      uploadDir: sharedPath,
      maxFileSize: maxUploadSize,
      maxFields,
    });
  
    form.parse(req, async (err, fields, { files: filesIn }) => {
      if (err) {
        console.error('Upload failed', err);
        res.status(400).send({ error: { message: err.message } });
        return;
      }

      if (filesIn) {
        const files = Array.isArray(filesIn) ? filesIn : [filesIn];

        // console.log(JSON.stringify({ fields, files }, null, 2));
        console.log('Uploaded files:');
        files.forEach((f) => console.log(f.name, `(${f.size} bytes)`));

        await pMap(files, async (file) => {
          try {
            const targetPath = join(sharedPath, filenamify(file.name, { maxLength: 255 }));
            if (!(await fs.pathExists(targetPath))) await fs.rename(file.path, targetPath);
          } catch (err) {
            console.error(`Failed to rename ${file.name}`, err);
          }  
        }, { concurrency: 10 });
      }
      res.end();
    });
  }));

  // NOTE: Must support non latin characters
  app.post('/api/paste', bodyParser.urlencoded({ extended: false }), asyncHandler(async (req, res) => {
    if (req.session.isLoggedIn == undedfined || !req.session.isLoggedIn)
      return res.status(401).json({ error: 'User not logged in' });
    if(req.session.ClipboardAllowed == undefined || !req.session.ClipboardAllowed)
      return res.status(403).json({ error: 'Permission denied' });
    
    if (req.body.saveAsFile === 'true') {
      await fs.writeFile(getFilePath(`client-clipboard-${new Date().getTime()}.txt`), req.body.clipboard);
    } else {
      await clipboardy.write(req.body.clipboard);
    }
    res.end();
  }));

  // NOTE: Must support non latin characters
  app.post('/api/copy', asyncHandler(async (req, res) => {
    if (req.session.isLoggedIn == undefined || !req.session.isLoggedIn)
      return res.status(401).json({ error: 'User not logged in' });
    if(req.session.ClipboardAllowed == undefined || !req.session.ClipboardAllowed)
      return res.status(403).json({ error: 'Permission denied' });

    res.send(await clipboardy.read());
  }));
  
  async function serveDirZip(filePath, res) {
    const archive = archiver('zip', {
      zlib: { level: zipCompressionLevel },
    });

    res.writeHead(200, {
      'Content-Type': 'application/zip',
      // NOTE: Must support non latin characters
      'Content-disposition': contentDisposition(`${basename(filePath)}.zip`),
    });

    const promise = pipeline(archive, res);

    archive.directory(filePath, basename(filePath));
    archive.finalize();

    await promise;
  }

  async function serveResumableFileDownload({ filePath, range, res, forceDownload }) {
    if (forceDownload) {
      // Set the filename in the Content-disposition header
      res.set('Content-disposition', contentDisposition(basename(filePath)));
    }

    const { size: fileSize } = await fs.stat(filePath);

    if (range) {
      const subranges = parseRange(fileSize, range);
      if (subranges.type !== 'bytes') throw new Error(`Invalid range type ${subranges.type}`);

      if (subranges.length !== 1) throw new Error('Only a single range is supported');
      const [{ start, end }] = subranges;

      const contentLength = (end - start) + 1;

      // Set headers for resumable download
      res.status(206).set({
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': contentLength,
        'Content-Type': 'application/octet-stream',
      });

      await pipeline(fs.createReadStream(filePath, { start, end }), res);
    } else {
      // Standard download without resuming
      res.set({
        // 'Content-Type': 'application/octet-stream',
        'Content-Length': fileSize,
      });

      await pipeline(fs.createReadStream(filePath), res);
    }
  }

  app.get('/api/download', asyncHandler(async (req, res) => {
    if (req.session.isLoggedIn == undefined || !req.session.isLoggedIn)
      return res.status(401).json({ error: 'User not logged in' });

    const filePath = getFilePath(req.query.f);
    const forceDownload = req.query.forceDownload === 'true';
    const isDir = await isDirectory(filePath);
 
    if (isDir) {
      await serveDirZip(filePath, res);
    } else {
      const { range } = req.headers;
      await serveResumableFileDownload({ filePath, range, res, forceDownload });
    }
  }));
  

  app.get('/api/browse', asyncHandler(async (req, res) => {
    if (req.session.isLoggedIn == undefined || !req.session.isLoggedIn)
      return res.status(401).json({ error: 'User not logged in' });

    let entries = [];
    let curRelPath = "";
    let curAbsPath = "";

    curRelPath = req.query.p || '/';
    curAbsPath = getFilePath(curRelPath);
    let readdirEntries = await fs.readdir(curAbsPath);
    readdirEntries = readdirEntries.sort(new Intl.Collator(undefined, {numeric: true}).compare);
    entries = (await pMap(readdirEntries, async (entry) => {
      try {
        const fileAbsPath = join(curAbsPath, entry); // TODO what if a file called ".."
        const fileRelPath = join(curRelPath, entry);
        const isDir = await isDirectory(fileAbsPath);
  
        return {
          path: fileRelPath,
          isDir,
          fileName: entry,
        };
      } catch (err) {
        console.warn(err.message);
        // https://github.com/mifi/ezshare/issues/29
        return undefined;
      }
    }, { concurrency: 10 })).filter((f) => f);

    res.send({
      files: [
        { path: join(curRelPath, '..'), fileName: '..', isDir: true },
        ...entries
      ],
      curRelPath,
      sharedPath,
    });
  }));

  console.log(`Sharing path ${sharedPath}`);

  //Database
  const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: {
      ca: fs.readFileSync('./ca.pem') // Path to your CA certificate file
    }
  });

  // Handle MySQL connection errors
  connection.connect((err) => {
    if (err) {
      console.error('MySQL connection failed: ', err.stack);
      return;
    }
    console.log('Connected to MySQL server');
  });

  // Endpoint to handle login requests
  app.post('/api/login', (req, res) => {
    if(req.session.isLoggedIn)
      return res.status(400).json({ error: 'User already logged in' });

    const { username, hashedPassword } = req.body;

    // Query the database for credentials
    // Use parameterized query to prevent SQL injection
    const sql = 'SELECT * FROM Credentials WHERE username = ? AND password = ?';
    connection.query(sql, [username, hashedPassword], (error, results, fields) => 
    {
      if (error) 
      {
        console.error('Error querying database: ', error);
        return res.status(500).json({ error: 'Internal server error' });
      }

      if (results.length > 0) 
      {
        // User authenticated
        req.session.username = username;
        req.session.isLoggedIn = true;
        req.session.ClipboardAllowed = results[0].ClipboardAllowed
        req.session.UploadAllowed = results[0].UploadAllowed
        let user_data = {};
        user_data.ClipboardAllowed = req.session.ClipboardAllowed;
        user_data.UploadAllowed = req.session.UploadAllowed;
        return res.json({ success: true, message: 'Login successful', data: user_data });
      } else {
        // Authentication failed
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    });
  });

  //Endpoint to handle logout
  app.post('/api/logout', (req, res) => {
    if(!req.session)
      return res.status(401).json({ error: 'User not logged in' });

    req.session.destroy((err) => {
      if (err) {
        console.error('Error destroying session:', err);
        return res.status(500).json({ error: 'Failed to logout' });
      }
      // Session destroyed successfully
      return res.json({ success: true, message: 'Logout successful' });
    });
  });

  app.listen(port, () => {
    const interfaces = os.networkInterfaces();
    const urls = flatMap(Object.entries(interfaces), ([name, addresses]) => {
      if (name !== 'Ethernet' && name !== 'Wireless' && name !== 'Wifi') {
          return [];
      }
      return addresses;
  }).filter(({ family, address }) => family === 'IPv4' && address !== '127.0.0.1' && isPrivateIP(address))
  .map(({ address }) => `http://${address}:${port}/`);
    if (urls.length === 0) return;
    console.log('Server listening:');
    urls.forEach((url) => {
      console.log(`App url: ${url}`);
      //qrcode.generate(url);
    });
  });

  // Serving the frontend depending on dev/production
  if (devMode) app.use('/', createProxyMiddleware({ target: 'http://localhost:3000', ws: true }));
  else app.use('/', express.static(join(__dirname, 'ezshare-frontend/dist')));

  // Default to index because SPA
  app.use('*', (req, res) => res.sendFile(join(__dirname, 'ezshare-frontend/dist/index.html')));  
};
