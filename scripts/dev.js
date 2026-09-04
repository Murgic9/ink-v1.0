const { spawn } = require('child_process');

const server = spawn('npx', ['nodemon', 'server.js'], {
  stdio: 'inherit',
  shell: true,
});

server.on('exit', (code) => {
  process.exit(code ?? 0);
});
