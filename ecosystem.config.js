// PM2 process file:  pm2 start ecosystem.config.js  &&  pm2 save  &&  pm2 startup
module.exports = {
  apps: [{
    name: 'medicircle-hms',
    script: 'server.js',
    instances: 1, // keep 1: login rate limiting is in-memory
    autorestart: true,
    max_memory_restart: '400M',
    env: { NODE_ENV: 'production' },
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    time: true,
  }],
};
