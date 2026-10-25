const { app, BrowserWindow, protocol, net, ipcMain } = require('electron');
const { readFileSync } = require('node:fs');
const { join, extname } = require('node:path');
const { pathToFileURL } = require('node:url');
app.setPath('userData', '/Users/agmazin/Library/Developer/paseo-dialogs-menu-profile');
protocol.registerSchemesAsPrivileged([{ scheme:'paseo', privileges:{standard:true,secure:true,supportFetchAPI:true} }]);
app.whenReady().then(async()=>{
 app.dock?.hide();
 protocol.handle('paseo', request=>{
  const path=decodeURIComponent(new URL(request.url).pathname);
  return net.fetch(pathToFileURL(join('/Applications/Paseo.app/Contents/Resources/app-dist',!path||!extname(path)?'index.html':path)).toString());
 });
 for (const name of ['paseo:get-pending-open-project','paseo:agent-navigation:ready','paseo:window:updateChrome','paseo:window:setBadgeCount','paseo:window:isMaximized','paseo:window:isFullscreen','paseo:menu:set-capturing-shortcut','paseo:browser:set-shortcut-policy','paseo:browser:set-workspace-active-browser']) ipcMain.handle(name,()=>null);
 ipcMain.handle('paseo:invoke',(_event,command,args)=>{
  const home='/Users/agmazin/Library/Developer/paseo-dialogs-menu-home';
  const pid=JSON.parse(readFileSync(home+'/paseo.pid'));
  if (command==='desktop_daemon_status'||command==='start_desktop_daemon') return {...pid,status:'running',home,version:'0.12.0',desktopManaged:true,ownedByDesktop:true};
  if(command==='desktop_local_credential')return readFileSync(home+'/local-credential','utf8').trim();
  if(command==='get_local_daemon_version')return '0.12.0';
  console.log('INVOKE',command);return null;
 });
 ipcMain.handle('paseo:dialog:ask',()=>true);
 const w=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{preload:'/Applications/Paseo.app/Contents/Resources/app.asar/dist/preload.js',sandbox:true,contextIsolation:true}});
 w.webContents.on('console-message',(_event,_level,message)=>console.log('RENDERER',message));
 await w.loadURL('paseo://app/');
});
