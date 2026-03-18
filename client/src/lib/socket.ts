import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({ path: '/socket.io', transports: ['websocket'] });
  }
  return socket;
}

export function subscribeToRepo(repoId: string): void {
  getSocket().emit('subscribe:repo', repoId);
}
