module.exports = {
  apps: [{
    name:               'betquizz',
    script:             'server.js',
    cwd:                './backend',
    instances:          1,
    autorestart:        true,
    watch:              false,
    max_memory_restart: '500M',
    error_file:         '../logs/err.log',
    out_file:           '../logs/out.log',
    log_file:           '../logs/combined.log',
    time:               true,
    env_production: {
      NODE_ENV: 'production',
    },
  }],
};
