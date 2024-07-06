import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

import { Route } from 'react-router';
import { Switch, useLocation, Link } from 'react-router-dom';
import { FaFileArchive, FaFileDownload, FaFileAlt, FaFolder, FaFileUpload, FaSpinner, FaShareAlt, FaRedoAlt } from 'react-icons/fa';
import { useDropzone } from 'react-dropzone';
import Swal from 'sweetalert2';
import Clipboard from 'react-clipboard.js';
import { motion, AnimatePresence } from 'framer-motion';
import CryptoJS from 'crypto-js';
import { CircularProgressbar } from 'react-circular-progressbar';
import 'react-circular-progressbar/dist/styles.css';
import argon2 from "argon2-browser/dist/argon2-bundled.min.js";
import seedrandom from 'seedrandom';
import { Buffer } from 'buffer';

const Toast = Swal.mixin({
  toast: true,
  showConfirmButton: false,
  timer: 3000,
  position: 'top',
})

// A custom hook that builds on useLocation to parse
// the query string for you.
function useQuery() {
  return new URLSearchParams(useLocation().search);
}

const colorLink = '#db6400';
const colorLink2 = '#ffa62b';

const boxBackgroundColor = '#fff';
const headingBackgroundColor = '#16697a';
const iconColor = '#ffa62b'; // 'rgba(0,0,0,0.3)'
const greenColor = '#90D26D';
const redColor = '#FF6868';

const linkStyle = {
  color: 'rgba(0,0,0,0.9)',
  minWidth: 50,
  textDecoration: 'none',
  wordBreak: 'break-all',
};

const fileRowStyle = { borderTop: '1px solid #d1cebd', margin: '4px 0', padding: '4px 0 2px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };

const Section = ({ children, style }) => (
  <div style={{ boxSizing: 'border-box', width: '100%', maxWidth: 600, marginLeft: 'auto', marginRight: 'auto', marginBottom: 50, padding: '20px 15px 25px 15px', borderRadius: 5, ...style }}>
    {children}
  </div>
);

const Uploader = ({ onUploadSuccess }) => {
  const [uploadProgress, setUploadProgress] = useState();
  const [uploadSpeed, setUploadSpeed] = useState();

  const onDrop = useCallback((acceptedFiles, rejectedFiles) => {
    // console.log(acceptedFiles);

    if (rejectedFiles && rejectedFiles.length > 0) {
      Toast.fire({ icon: 'warning', title: 'Some file was not accepted' });
    }

    async function upload() {
      let dataTotal;
      let dataLoaded;
      let startTime;

      try {
        // Toast.fire({ title: `${acceptedFiles.length} ${rejectedFiles.length}` });
        setUploadProgress(0);
        const data = new FormData();
        acceptedFiles.forEach((file) => data.append('files', file));
    
        function onUploadProgress(progressEvent) {
          dataTotal = progressEvent.total;
          dataLoaded = progressEvent.loaded;
          if (!startTime && dataLoaded) startTime = new Date().getTime();
          setUploadProgress(dataLoaded / dataTotal);
          if (dataLoaded && startTime) setUploadSpeed(dataLoaded / ((new Date().getTime() - startTime) / 1000));
        }

        await axios.post('/api/upload', data, { onUploadProgress });

        Toast.fire({ icon: 'success', title: 'File(s) uploaded successfully' });
        onUploadSuccess();
      } catch (err) {
        console.error('Upload failed', err);
        const message = err.response?.data?.error?.message || err.message;
        Toast.fire({ icon: 'error', title: `Upload failed: ${message}` });
      } finally {
        setUploadProgress();
        setUploadSpeed();
      }
    }

    upload();
  }, [onUploadSuccess]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  if (uploadProgress != null) {
    const percentage = Math.round(uploadProgress * 100);
    return (
      <div style={{ display: 'flex', alignItems: 'center', flexDirection: 'column' }}>
      <div style={{ width: 100 }}>
        <CircularProgressbar value={percentage} text={`${percentage}%`} />
      </div>
      {uploadSpeed && <div>{(uploadSpeed / 1e6).toFixed(2)}MB/s</div>}
    </div>
    );
  }

  return (
    <div {...getRootProps()} style={{ outline: 'none',  background: boxBackgroundColor, cursor: 'pointer', padding: '30px 0', border: `3px dashed ${isDragActive ? 'rgba(255,0,0,0.4)' : 'rgba(0,0,0,0.1)'}`, borderRadius: 10, display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
      <input {...getInputProps()} />

      <FaFileUpload size={50} style={{ color: iconColor }} />

      <div style={{ marginTop: 20, padding: '0 30px' }}>
        {isDragActive ? 'Drop files here to upload' : 'Drag \'n drop some files here, or press to select files to upload'}
      </div>
    </div>
  );
}

const getDownloadUrl = (path, forceDownload) => `/api/download?f=${encodeURIComponent(path)}&forceDownload=${forceDownload ? 'true' : 'false'}&_=${new Date().getTime()}`;

const FileDownload = ({ url }) => <a style={{ textDecoration: 'none', marginLeft: 10, marginBottom: -5, color: colorLink }} href={url} title="Download file"><FaFileDownload size={22} /></a>;
const ZipDownload = ({ url }) => <a style={{ textDecoration: 'none', marginLeft: 10, marginBottom: -5, color: colorLink2 }} href={url} title="Download folder as ZIP"><FaFileArchive size={22} /></a>;

const FileRow = ({ path, isDir, fileName }) => {
  const Icon = isDir ? FaFolder : FaFileAlt;

  return (
    <div key={`${path}_${fileName}`} style={fileRowStyle}>
      <Icon size={16} style={{ color: 'rgba(0,0,0,0.5)', marginRight: 10 }} />
      {isDir ? (
        <>
          <Link to={{ pathname: '/', search: `?p=${encodeURIComponent(path)}`}} style={linkStyle}>{fileName} {fileName === '..' && <span style={{ color: 'rgba(0,0,0,0.3)' }}>(parent dir)</span>}</Link>
          <div style={{ flexGrow: 1 }} />
          <ZipDownload url={getDownloadUrl(path)} />
        </>
      ) : (
        <>
          <a style={linkStyle} target="_blank" rel="noopener noreferrer" href={getDownloadUrl(path)}>{fileName}</a>
          <div style={{ flexGrow: 1 }} />
          <FileDownload url={getDownloadUrl(path, true)} />
        </>
      )}
    </div>
  );
};

const Browser = () => {
  const [currentDirFiles, setCurrentDirFiles] = useState({ files: [] });
  const [clipboardText, setClipboardText] = useState();
  const [saveAsFile, setSaveAsFile] = useState(false);

  const urlSearchParams = useQuery();
  const rootPath = '/'
  const currentPath = urlSearchParams.get('p') || rootPath;

  const isLoadingDir = currentPath !== currentDirFiles.curRelPath;
  const isInRootDir = currentPath === rootPath;

  const [isLoggedOn, setIsLoggedOn] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [registerUsername, setRegisterUsername] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [RERegisterPassword, setRERegisterPassword] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerClipboardPerm, setRegisterClipboardPerm] = useState('');
  const [registerUploadPerm, setRegisterUploadPerm] = useState('');
  const [changePassword, setChangePassword] = useState('');
  const [REChangePassword, setREChangePassword] = useState('');
  const [hasClipboardPerms, setHasClipboardPerms] = useState(false);
  const [hasUploadPerms, setHasUploadPerms] = useState(false); 
  const [isChangePassword, setIsChangePassword] = useState(false); 
  const [isRegister, setIsRegister] = useState(false); 
  const [popupArray, setPopupArray] = useState([]);
  const [isValid, setIsValid] = useState({
    length: false,
    uppercase: false,
    number: false,
    specialChar: false,
    match: false
  });
  const [isRegValid, setIsRegValid] = useState({
    length: false,
    uppercase: false,
    number: false,
    specialChar: false,
    match: false
  });

  const loadCurrentPath = useCallback(async () => {
    try {
      const response = await axios.get('/api/browse', { params: { p: currentPath} });
      setCurrentDirFiles(response.data);
    } catch (err) {
      console.error(err);
    }
  }, [currentPath]);

  useEffect(() => {
    const fetchSessionData = async () => {
      try {
        const response = await fetch('/api/sessionRecovery');
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        const data = await response.json();
        setIsLoggedOn(data.data.isLoggedIn);
        setUsername(data.data.username);
        setHasClipboardPerms(data.data.ClipboardAllowedd);
        setHasUploadPerms(data.data.UploadAllowed);
        setIsRegister(data.data.RegisterAllowed);
        localStorage.setItem('username', username);
        handleRefreshClick();
      } catch (err) {

      }
    };
    fetchSessionData();
  }, []);

  useEffect(() => {
    loadCurrentPath();
  }, [loadCurrentPath]);

  function handleUploadSuccess() {
    if (isInRootDir) loadCurrentPath();
  }

  function handleRefreshClick() {
    loadCurrentPath();
  }

  //Failover in case directory does not exist at all
  let dirs = { map(){} };
  let nonDirs = { map(){}};
  if(currentDirFiles.files) 
  {
    dirs = currentDirFiles.files.filter(f => f.isDir);
    nonDirs = currentDirFiles.files.filter(f => !f.isDir);
  }

  async function onPaste(e) {
    e.preventDefault();
    e.target.blur();

    try {
      const clipboardData = e.clipboardData.getData('Text');
      const data = new URLSearchParams();
      data.append('clipboard', clipboardData);
      data.append('saveAsFile', saveAsFile);
      await axios.post('/api/paste', data);

      Toast.fire({ icon: 'success', title: saveAsFile ? 'Pasted text has been saved to a file on other side' : 'Pasted text has been sent to the clipboard on other side' });
    } catch (err) {
      console.error(err);
      Toast.fire({ icon: 'error', title: 'Paste clipboard failed' });
    }
  }

  async function onGetClipboard() {
    try {
      const response = await axios.post('/api/copy');

      setClipboardText(response.data);
    } catch (err) {
      console.error(err);
      Toast.fire({ icon: 'error', title: 'Copy clipboard failed' });
    }
  }

  function onClipboardCopySuccess() {
    Toast.fire({ icon: 'success', title: 'Text has been copied from the other side\'s clipboard' });
    setClipboardText();
  }


  const Popup = ({ id, message, onAnimationEnd, isError = false }) => {
    const [isVisible, setIsVisible] = useState(true);
  
    useEffect(() => {
      const timer = setTimeout(() => {
        setIsVisible(false);
        onAnimationEnd(id); // Notify parent component that animation has ended
      }, 3000); // 5000 milliseconds (5 seconds) for fadeOut animation
  
      return () => clearTimeout(timer);
    }, [id, onAnimationEnd]);
 
    return (
      isVisible && (
        <div
          style={{
            position: 'fixed',
            animation: 'fadeOut 3s forwards',
            border: '1px solid rgba(0,0,0,0.5)',
            borderRadius: 18,
            height: '5%',
            width: '25%',
            top: '1%',
            right: 0,
            left: '74%',
            zIndex: 1000,
            backgroundColor: isError ? redColor : greenColor, // Assuming greenColor is not used here
            textAlign: 'center',
            color: 'white',
            fontSize: 28,
            padding: '10px 0',
            paddingTop: '15px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {message}
        </div>
      )
    );
  };

  const checkPasswordCriteria = (pssd, repssd) => {
    setIsValid({
      length: pssd.length >= 12,
      uppercase: /[A-Z]/.test(pssd),
      number: /\d/.test(pssd),
      specialChar: /[!@#\-,.]/.test(pssd),
      match: pssd == repssd
    });
  };

  const checkPasswordRegisterCriteria = (pssd, repssd) => {
    setIsRegValid({
      length: pssd.length >= 12,
      uppercase: /[A-Z]/.test(pssd),
      number: /\d/.test(pssd),
      specialChar: /[!@#\-,.]/.test(pssd),
      match: pssd == repssd
    });
  };

  // Call checkPasswordCriteria whenever password changes
  React.useEffect(() => {
    checkPasswordCriteria(changePassword, REChangePassword);
  }, [changePassword, REChangePassword]);
  React.useEffect(() => {
    checkPasswordRegisterCriteria(registerPassword, RERegisterPassword);
  }, [registerPassword, RERegisterPassword]);

  const generateSalt = (usr) => {
    return usr;
  };

  const hashPassword = async (pswd, usr) =>
  {
    try
    {
      const hash = await argon2.hash({
        pass: pswd,
        salt: generateSalt(usr),
        type: argon2.ArgonType.Argon2d,
      });
      const h = hash.encoded.split('$');
      return h[h.length - 1];
    }
    catch (error) 
    {
      console.log("Error when hashing the password... ", error);
      return undefined;
    }
  };

  const hashUsername = async (usr, pswd) =>
  {
    try
    {
      const hash = await argon2.hash({
        pass: usr,
        salt: generateSalt(pswd),
        type: argon2.ArgonType.Argon2d,
      });
      const h = hash.encoded.split('$');
      return h[h.length - 1];
    }
    catch (error) 
    {
      console.log("Error when hashing the username... ", error);
      return undefined;
    }
  };

  const handleRegister = async  () => {


    if(registerPassword != RERegisterPassword)
    {
      const newPopupArray = [...popupArray, { id: Date.now(), message: 'Passwords do not match!', isError: true }];
      setPopupArray(newPopupArray);
      return undefined;
    }

    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d])[A-Za-z\d!@#$%^&*()_+=[\]{};':"\\|,.<>/?`~\-]{12,}$/;
    if (!passwordRegex.test(registerPassword)) {
      // Password does not meet criteria
      const newPopupArray = [...popupArray, { id: Date.now(), message: 'Requirements not met!', isError: true }];
      setPopupArray(newPopupArray);
      return undefined;
    }

    try {
        const hashedUsername = await hashUsername(registerUsername, registerUsername + registerUsername);
        const hashedPassword = await hashPassword(registerPassword, hashedUsername);
        
        const response = await fetch('/api/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ hashedUsername, hashedPassword, registerEmail, registerClipboardPerm, registerUploadPerm })
        });

        if (!response.ok) {
          const newPopupArray = [...popupArray, { id: Date.now(), message: 'Register failed...', isError: true }];
          setPopupArray(newPopupArray);
          throw new Error('Register failed');
        }

        const newPopupArray = [...popupArray, { id: Date.now(), message: 'Register successful!', isError: false }];
        setPopupArray(newPopupArray);
    }catch (error) {
      const newPopupArray = [...popupArray, { id: Date.now(), message: 'Register failed...', isError: true }];
        setPopupArray(newPopupArray);
      console.error('Register error:', error.message);
    }
  };

  const handleLogin = async  () => {
    try {
      const hashedUsername = await hashUsername(username, username + username);
      const hashedPassword = await hashPassword(password, hashedUsername);
      
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, hashedUsername, hashedPassword })
      });

      if (!response.ok) {
        setIsLoggedOn(false);
        const newPopupArray = [...popupArray, { id: Date.now(), message: 'Login failed...', isError: true }];
        setPopupArray(newPopupArray);
        throw new Error('Login failed');
      }

      localStorage.setItem('username', username);
      const data = await response.json();
      setHasClipboardPerms(data.data.ClipboardAllowed);
      setHasUploadPerms(data.data.UploadAllowed);
      setIsRegister(data.data.RegisterAllowed);
      handleRefreshClick();
      setIsLoggedOn(true);
      const newPopupArray = [...popupArray, { id: Date.now(), message: 'Login successful!', isError: false }];
      setPopupArray(newPopupArray);
      // Optionally, redirect to another page or perform other actions upon successful login

    } catch (error) {
      console.error('Login error:', error.message);
    }
  };

  const handleLogout = async () => 
  {
    try 
    {
      const response = await fetch('/api/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok)
    {
      throw new Error('Logout failed');
    }
      
    setIsLoggedOn(false);
    setIsChangePassword(false);
    setIsRegister(false);
    handleRefreshClick();
    }
    catch (error) 
    {
      console.error('Logout failed:', error);
    }
  };

  const handleInitiateChangePassword = () => 
  {
    setIsChangePassword(!isChangePassword);
  };

  const handleChangePassword = async () => 
  {
    if(changePassword != REChangePassword)
    {
      const newPopupArray = [...popupArray, { id: Date.now(), message: 'Passwords do not match!', isError: true }];
      setPopupArray(newPopupArray);
      return undefined;
    }

    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d])[A-Za-z\d!@#$%^&*()_+=[\]{};':"\\|,.<>/?`~\-]{12,}$/;
    if (!passwordRegex.test(changePassword)) {
      // Password does not meet criteria
      const newPopupArray = [...popupArray, { id: Date.now(), message: 'Requirements not met!', isError: true }];
      setPopupArray(newPopupArray);
      return undefined;
    }
    
    try {
      const localUsername = localStorage.getItem('username');
      const hashedUsername = await hashUsername(localUsername, localUsername + localUsername);
      const hashedPassword = await hashPassword(changePassword, hashedUsername);

      const response = await axios.post('/api/changePassword', {
        newUsername: hashedUsername, newPassword: hashedPassword
      });
      if (response.data.success) {
        // Password changed successfully
        const newPopupArray = [...popupArray, { id: Date.now(), message: 'Password changed successfully!', isError: false }];
        setPopupArray(newPopupArray);
        setChangePassword('');
        setREChangePassword('');
        setIsChangePassword(false);
      } else {
        // Handle error
        const newPopupArray = [...popupArray, { id: Date.now(), message: 'Password change failed!', isError: true }];
        setPopupArray(newPopupArray);
      }
    } catch (error) {
      console.error('Error changing password:', error.message);
      const newPopupArray = [...popupArray, { id: Date.now(), message: 'Password change failed!', isError: true }];
      setPopupArray(newPopupArray);
    }
  };

  const handlePopupAnimationEnd = (popupId) => {
    const updatedPopupArray = popupArray.filter(popup => popup.id !== popupId);
    setPopupArray(updatedPopupArray);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div className="pulsing-header-div" style={{ position: 'fixed', top: 0, right: 0, left: 0, textAlign: 'center', backgroundColor: headingBackgroundColor, borderBottom: '2px solid rgba(0,0,0,0.2)', color: 'white', fontSize: 36, padding: '10px 0', paddingLeft: '20px', display: 'flex', alignItems: 'center', justifyContent: isLoggedOn ? !isChangePassword ? 'center' : 'space-between' : 'space-between' }}>
        {/*<FaSpinner className="icon-spin" style={{ visibility: !isLoadingDir ? 'hidden' : undefined, marginRight: 10 }} size={20} />*/}
        
        {/* eslint-disable-next-line jsx-a11y/accessible-emoji */}
        <div>EzShare 🤝</div>
        
      </div>

      {true && (
        <div style={{ marginTop: '60px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {popupArray.slice(-3).map((popup) => (
          <Popup key={popup.id} id={popup.id} message={popup.message} isError={popup.isError} onAnimationEnd={handlePopupAnimationEnd} />
        ))}
      </div>
      )}

      <div style={{ display: isRegister ? 'block' : 'none' }}>
      {isRegister && (<div>
        <h2></h2>
        <div>
          Register:
          <input
              type="text"
              placeholder="Username"
              value={registerUsername}
              onChange={(e) => setRegisterUsername(e.target.value)}
              style={{ display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center', padding: '10px 0', border: '1px solid rgba(0,0,0,0.3)', fontFamily: 'inherit', fontSize: 15, borderRadius: 6 }}
            />
            <input
              type="password"
              placeholder="Password"
              value={registerPassword}
              onChange={(e) => setRegisterPassword(e.target.value)}
              style={{ display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center', padding: '10px 0', border: '1px solid rgba(0,0,0,0.3)', fontFamily: 'inherit', fontSize: 15, borderRadius: 6 }}
            />
            <input
              type="password"
              placeholder="Retype pass"
              value={RERegisterPassword}
              onChange={(e) => setRERegisterPassword(e.target.value)}
              style={{ display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center', padding: '10px 0', border: '1px solid rgba(0,0,0,0.3)', fontFamily: 'inherit', fontSize: 15, borderRadius: 6 }}
            />
            <input
              type="text"
              placeholder="email"
              value={registerEmail}
              onChange={(e) => setRegisterEmail(e.target.value)}
              style={{ display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center', padding: '10px 0', border: '1px solid rgba(0,0,0,0.3)', fontFamily: 'inherit', fontSize: 15, borderRadius: 6 }}
            />
            <input
              type="checkbox"
              checked={registerClipboardPerm}
              onChange={(e) => setRegisterClipboardPerm(e.target.checked)}
            />
            <input
              type="checkbox"
              checked={registerUploadPerm}
              onChange={(e) => setRegisterUploadPerm(e.target.checked)}
            />
            <button onClick={handleRegister} style={{ padding: 10, width: '55%', boxSizing: 'border-box', backgroundColor: colorLink, border: 'none', borderRadius: 6, color: 'white', fontWeight: 'bold', fontSize: 17 }}>Register</button>
        </div>
      </div>)}
      </div>

      <div style={{ display: isRegister ? 'block' : 'none' }}>
      {isRegister && (
        <div>
          <h2></h2>
          <div style={{
            fontSize: 32
            }}>
            Password register requirements:
          </div>
          <ul style={{
            fontSize: 24,
            }}>
             <li style={{ color: isRegValid.length ? 'green' : 'red' }}>At least 12 characters;</li>
             <li style={{ color: isRegValid.uppercase ? 'green' : 'red' }}>At least one character uppercase;</li>
             <li style={{ color: isRegValid.number ? 'green' : 'red' }}>At least one number;</li>
             <li style={{ color: isRegValid.specialChar ? 'green' : 'red' }}>At least one special character (!@#-,.);</li>
             <li style={{ color: isRegValid.match ? 'green' : 'red' }}>Passwords must match;</li>
          </ul>
        </div>
      )}
      </div>

      <div style={{ display: isChangePassword ? 'block' : 'none' }}>
      {isChangePassword && (
        <div>
          <h2></h2>
          <div style={{
            fontSize: 32
            }}>
            Password change requirements:
          </div>
          <ul style={{
            fontSize: 24,
            }}>
             <li style={{ color: isValid.length ? 'green' : 'red' }}>At least 12 characters;</li>
             <li style={{ color: isValid.uppercase ? 'green' : 'red' }}>At least one character uppercase;</li>
             <li style={{ color: isValid.number ? 'green' : 'red' }}>At least one number;</li>
             <li style={{ color: isValid.specialChar ? 'green' : 'red' }}>At least one special character (!@#-,.);</li>
             <li style={{ color: isValid.match ? 'green' : 'red' }}>Passwords must match;</li>
          </ul>
        </div>
      )}
      </div>

      <div style={{ display: isLoggedOn ? 'block' : 'none' }}>
      {isLoggedOn  && (
        <div style={{
          position: 'fixed',
          borderRadius: 12,
          height: '4.5%',
          width: '20%',
          top: '0%',
          right: "1%",
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          //backgroundColor: 'rgba(0, 0, 0, 0.5)', // Example background color for visibility
          padding: '5px', // Adjust padding for clickable area
          zIndex: 900
        }}>
          <button onClick={handleInitiateChangePassword}
            style={{
              padding: '10px', // Increase padding for larger clickable area
              backgroundColor: !isChangePassword ? '#4ea3df': '#34b9db',
              border: 'none',
              borderRadius: 6,
              color: 'white',
              fontWeight: 'bold',
              fontSize: 17,
              cursor: 'pointer', // Ensure cursor changes on hover
              marginLeft: '10px', // Adjust margin between buttons
              animation: isChangePassword ? 'pulse-blue 1s infinite' : 'none', // Apply animation conditionally
            }}>Change</button>
          <button onClick={handleLogout}
            style={{
              padding: '10px', // Increase padding for larger clickable area
              backgroundColor: '#e74c3c',
              border: 'none',
              borderRadius: 6,
              color: 'white',
              fontWeight: 'bold',
              fontSize: 17,
              cursor: 'pointer', // Ensure cursor changes on hover
              marginLeft: '10px', // Adjust margin between buttons
            }}>Logout</button>
        </div>
      )}
      </div>

      <div style={{ display: !isLoggedOn ? 'block' : 'none' }}>
      <div style={{ position: 'fixed', top: 0, right: 0, left: 0, textAlign: 'center', color: 'white', fontSize: 36, padding: '10px 0', paddingTop: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {!isLoggedOn && (
          <div style={{ display: 'flex', alignItems: 'center', marginRight: 15 }}>
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{ display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center', padding: '10px 0', border: '1px solid rgba(0,0,0,0.3)', fontFamily: 'inherit', fontSize: 15, borderRadius: 6 }}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center', padding: '10px 0', border: '1px solid rgba(0,0,0,0.3)', fontFamily: 'inherit', fontSize: 15, borderRadius: 6 }}
            />
            <button onClick={handleLogin} style={{ padding: 10, width: '35%', boxSizing: 'border-box', backgroundColor: colorLink, border: 'none', borderRadius: 6, color: 'white', fontWeight: 'bold', fontSize: 17 }}>Login</button>
          </div>
        )}
      </div>
      </div>

      <div style={{ display: isChangePassword ? 'block' : 'none' }}>
      {isChangePassword && (
        <div style={{ position: 'fixed', top: 0, right: 0, left: 0, textAlign: 'center', color: 'white', fontSize: 36, padding: '10px 0', paddingTop: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginRight: 15 }}>
            <input
              type="password"
              placeholder="Password"
              value={changePassword}
              onChange={(e) => setChangePassword(e.target.value)}
              style={{ display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center', padding: '10px 0', border: '1px solid rgba(0,0,0,0.3)', fontFamily: 'inherit', fontSize: 15, borderRadius: 6 }}
            />
            <input
              type="password"
              placeholder="Retype password"
              value={REChangePassword}
              onChange={(e) => setREChangePassword(e.target.value)}
              style={{ display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center', padding: '10px 0', border: '1px solid rgba(0,0,0,0.3)', fontFamily: 'inherit', fontSize: 15, borderRadius: 6 }}
            />
            <button onClick={handleChangePassword} style={{ padding: 10, width: '35%', boxSizing: 'border-box', backgroundColor: colorLink, border: 'none', borderRadius: 6, color: 'white', fontWeight: 'bold', fontSize: 17 }}>Change</button>
          </div>
          </div>)}
          </div>
    
      <div style={{ display: isLoggedOn && hasClipboardPerms ? 'block' : 'none' }}>
      {isLoggedOn && hasClipboardPerms && (<Section style={{ marginTop: 100 }}>
        <h2>Clipboard</h2>

        <div style={{ margin: 'auto', maxWidth: 350, width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', marginBottom: 10 }}>
            <input type="text" onPaste={onPaste} placeholder="Paste here to send clipboard" style={{ display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'center', padding: '10px 0', border: '1px solid rgba(0,0,0,0.3)', fontFamily: 'inherit', fontSize: 15, borderRadius: 6 }} />
            <div style={{ whiteSpace: 'nowrap' }}><input id="saveAsFile" type="checkbox" onChange={(e) => setSaveAsFile(e.target.checked)} checked={saveAsFile} style={{ marginLeft: 10, verticalAlign: 'middle' }} /> <label htmlFor="saveAsFile" style={{ verticalAlign: 'middle' }}>Save as file</label></div>
          </div>

          <AnimatePresence>
            {clipboardText ? (
              <motion.div
                key="div"
                style={{ width: '100%', originY: 0, padding: 10, boxSizing: 'border-box' }}
                initial={{ scaleY: 0, opacity: 0 }}
                animate={{ scaleY: 1, opacity: 1 }}
                exit={{ scaleY: 0, opacity: 0 }}
              >
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', alignSelf: 'stretch', background: 'rgba(0,0,0,0.04)', borderRadius: 5, padding: 5, margin: '10px 0', textAlign: 'center', boxSizing: 'border-box' }}>{clipboardText}</div>

                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%' }}>
                  <Clipboard data-clipboard-text={clipboardText} onSuccess={onClipboardCopySuccess} style={{ padding: 5, flexGrow: 1 }}>
                    Copy to clipboard
                  </Clipboard>
                  <button onClick={() => setClipboardText()} type="button" style={{ padding: 5, flexGrow: 1 }}>Cancel</button>
                </div>
              </motion.div>
            ) : (
              <button onClick={onGetClipboard} type="button" style={{ padding: 10, width: '100%', boxSizing: 'border-box', backgroundColor: colorLink, border: 'none', borderRadius: 6, color: 'white', fontWeight: 'bold', fontSize: 17 }}>Fetch clipboard from other side</button>
            )}
          </AnimatePresence>
        </div>
      </Section>)}
      </div>

      <div style={{ display: isLoggedOn && hasUploadPerms ? 'block' : 'none' }}>
      {isLoggedOn && hasUploadPerms && (<Section>
        <h2>Upload files</h2>
        <Uploader onUploadSuccess={handleUploadSuccess} />
      </Section>)}
      </div>

      <div style={{ display: isLoggedOn ? 'block' : 'none' }}>
      {isLoggedOn && (<Section>
        <h2>Download files</h2>

        <div style={{ wordBreak: 'break-all', padding: '0 5px 8px 5px', fontSize: '.85em', color: 'rgba(0,0,0,0.3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <FaShareAlt size={10} style={{ marginRight: 10 }} />
          {currentDirFiles.sharedPath}
          <div style={{ flexGrow: 1 }} />
          <FaRedoAlt size={12} role="button" style={{ color: colorLink, cursor: 'pointer', padding: '5px 1px 5px 5px' }} onClick={handleRefreshClick} />
        </div>

        <div style={{ ...fileRowStyle }}>
          <div style={{ wordBreak: 'break-all', fontWeight: 500 }}>{currentDirFiles.curRelPath} <span style={{ color: 'rgba(0,0,0,0.3)' }}>(current dir)</span></div>
          <ZipDownload url={getDownloadUrl(currentDirFiles.curRelPath)} />
        </div>

        {dirs.map(FileRow)}
        {nonDirs.map(FileRow)}
      </Section>)}
      </div>

      {/* eslint-disable-next-line jsx-a11y/accessible-emoji */}
      <div style={{ display: !isLoggedOn ? 'block' : 'none' }}>
      {!isLoggedOn && (<Section>
        <h2></h2>
        <h2></h2>
        <div className="pulsing-orange-div" style={{ animation: 'pulse-orange 3s ease-in-out infinite', boxShadow: '0px 0px 10px rgba(0, 0, 0, 0.75)', textAlign: 'center', marginBottom: 50, padding: 10, borderRadius: 18, fontSize: 36, border: `1px solid ${colorLink}`}}>
          You need to log in first!
        </div></Section>)}
        </div>
    </div>
  );
};

function App() {
  return (
    <div>
      <Switch>
        <Route path="/">
          <Browser />
        </Route>
      </Switch>
    </div>
  );
}

export default App;
