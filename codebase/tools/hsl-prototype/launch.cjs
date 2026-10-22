const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('../../desktop/node_modules/electron');
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(electron,[path.join(__dirname,'electron-main.cjs')],{env,stdio:'inherit',windowsHide:true});
child.on('error',e=>{console.error(e);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code || 0;});
