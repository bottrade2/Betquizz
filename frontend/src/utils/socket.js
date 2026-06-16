import { io } from 'socket.io-client';

const URL = process.env.REACT_APP_SOCKET_URL || undefined;

const socket = io(URL, {
  autoConnect: true,
  auth: { token: localStorage.getItem('token') },
});

// Refresh token if it was set after initial connection
socket.on('connect_error', (err) => {
  if (err.message === 'Authentication required' || err.message === 'Invalid token') {
    const token = localStorage.getItem('token');
    if (token) {
      socket.auth = { token };
      socket.connect();
    }
  }
});

export default socket;
