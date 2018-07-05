const VegaWS = require('./vega_ws.js');
const Config = require('./config.js');
const { exec } = require('child_process');
const moment = require('moment');
const Uint64BE = require("int64-buffer").Uint64BE;
let config = {};
let statusAuth = false;
let premission = {};
let ws = {};
//------------------------------------------------------------------------------
//Application logic
//------------------------------------------------------------------------------
function decToHex(dec)
{
  let hex = new Uint64BE(dec).toString(16);
  let hex_array=[];
  for (let i=0;i<hex.length-1;i=i+2)
  {
     hex_array.push( hex.substring(i, i+2) );
  }
  while(hex_array.length<8)
  {
    hex_array.unshift('00');
  }
  hex_array.reverse();
  hex = hex_array.join('');
  return hex;
}
function adjustTime(deviceTime,devEui)
{
  let currentTime = moment().utc().unix();
  let delay = 1;
  let deltaTime = currentTime-(deviceTime-delay);
  if(Math.abs(deltaTime)>5)
  {
    if(config.debugMOD) console.log('Need to adjust the time to '+deltaTime+' seconds, on the device with devEui '+devEui);
    let deltaTimeHex = decToHex(deltaTime);
    let message = 'ff'+deltaTimeHex;
    send_data_req(message,4,false,devEui);
  }
}
function parsePackageTime(data)
{
  data = data.toLowerCase()
  let result = {status:false};
  try
  {
    let hex_array=[];
    for (var i =0;i<data.length-1;i=i+2)
    {
       hex_array.push( data.substring(i, i+2) );
    }
    if(hex_array[0]=='ff')
    {
      let validTime = hex_array[4]!==undefined&&hex_array[3]!==undefined&&hex_array[2]!==undefined&&hex_array[1]!==undefined;
      if(validTime)
      {
        let hexTime = hex_array[4]+hex_array[3]+hex_array[2]+hex_array[1];
        let timeDevice = parseInt(hexTime,16);
        if(!isNaN(timeDevice))
        {
          result.time = timeDevice;
          result.status = true;
        }
      }
    }
  }
  catch (e)
  {
    result.status = false;
    console.error('ERROR parse package time',e);
  }
  finally
  {
    return result;
  }
}
//------------------------------------------------------------------------------
//ws send message
//------------------------------------------------------------------------------
function auth_req()
{
  let message = {
    cmd:'auth_req',
    login:config.loginWS,
    password:config.passwordWS
  };
  ws.send_json(message);
  return;
}
function send_data_req(data,port,ack,devEui)
{
  let message={
      cmd:'send_data_req',
      data_list:[
        {
          devEui:devEui,
          data:data,
          port:parseInt(port),
          ack:ack
        }
      ]
  };
  ws.send_json(message);
  return;
}
//------------------------------------------------------------------------------
//commands iotvega.com
//------------------------------------------------------------------------------
function rx(obj)
{
  if(!(obj.type&&(obj.type.indexOf('UNCONF_UP')>-1||obj.type.indexOf('CONF_UP')>-1))) return;
  try
  {
    let timeServerMs = obj.ts;
    let data = obj.data;
    let devEui = obj.devEui;
    let port = obj.port;
    if(data&&port==4)
    {
      let packageTime = parsePackageTime(data);
      if(packageTime.status)
      {
        adjustTime(packageTime.time,devEui);
      }
    }
  }
  catch (e)
  {
    console.error(e);
  }
  finally
  {
    return;
  }
}
function auth_resp(obj)
{
  if(obj.status)
  {
    for(let i = 0 ; i<obj.command_list.length;i++)
    {
      premission[obj.command_list[i]] = true;
    }
    statusAuth = true;
    console.log('Success authorization on server iotvega');
    if(!premission['send_data'])
    {
      console.log('Attention!!! The user does not have sufficient rights to adjust the time. You must have rights to send data (command "send_data_req")');
    }
  }
  else
  {
    statusAuth = false;
    console.log('Not successful authorization on server iotvega');
    setTimeout(()=>{
      ws.reload();
    },10000);
  }
}
function alter_user_resp(obj)
{
  ws.reload();
}
function send_data_resp(obj)
{
  for(var i = 0; i<obj.append_status.length; i++)
  {
    if(obj.append_status[i].status)
    {
      if(config.debugMOD) console.log('The time on device '+obj.append_status[i].devEui+' has been successfully adjusted');
    }
    else
    {
      if(config.debugMOD) console.log('The time on device '+obj.append_status[i].devEui+' has not been adjusted');
    }
  }
}
//------------------------------------------------------------------------------
//initalization app
//------------------------------------------------------------------------------
function initWS()
{
  ws = new VegaWS(config.ws);
  ws.on('run',auth_req);
  ws.on('auth_resp',auth_resp);
  ws.on('rx',rx);
  ws.on('alter_user_resp',alter_user_resp);
  ws.on('send_data_resp',send_data_resp);
}
function run(conf)
{
  config = conf;
  if(config.valid())
  {
    try
    {
      initWS();
    }
    catch (e)
    {
      console.log('Initializing the application was a mistake');
      console.error(e);
    }
  }
  return;
}
module.exports.config = config;
module.exports.run = run;
