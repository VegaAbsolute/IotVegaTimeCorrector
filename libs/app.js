//app.js version 1.0.1
const DELAY = 1;
const COUNT_BYTE_IN_PACKATE_TIME = 4;
const PORT_PACKATE_TIME = 4;
const RX_DELAY = 60000;

let VegaWS = require( './vega_ws.js' );
let moment = require( 'moment' );
let Uint64BE = require( 'int64-buffer' ).Uint64BE;

let config = new Object();
let statusAuth = false;
let premission = new Object();
let ws = new Object();
let history = new Object();
//------------------------------------------------------------------------------
//Application logic
//------------------------------------------------------------------------------
//Функция конвертирующая десятичное целое число в HEX
function decToHex ( dec )
{
  try
  {
    let hex = new Uint64BE( dec ).toString( 16 );
    let bytes = [];
    if( hex.length % 2 !== 0 )
    {
        hex = '0' + hex;
    }
    for ( let i = 0; i < hex.length - 1; i = i + 2 )
    {
      let byte = hex.substring( i, i + 2 );
      if( byte.length == 1 )
      {
        byte = '0' + byte;
      }
      bytes.push( byte );
    }
    let lengthHex = COUNT_BYTE_IN_PACKATE_TIME * 2;
    while ( bytes.length < lengthHex )
    {
      bytes.unshift( '00' );
    }
    bytes.reverse();
    hex = bytes.join( '' );
    return hex;
  }
  catch (e)
  {
    if ( config.debugMOD ) console.error( moment().format('LLL'), e );
    return '';
  }
}
//Корректирует время если это нужно
function adjustTime ( deviceTime, devEui )
{
  let logText = '';
  let currentTime = moment().utc().unix();
  let deltaTime = currentTime - ( deviceTime - DELAY );
  if ( Math.abs(deltaTime) > 5 )
  {
    history[devEui] = currentTime;
    logText = ': Need to adjust the time to '+deltaTime+' seconds, on the device with devEui '+devEui;
    if ( config.debugMOD ) console.log( moment().format('LLL'), logText);
    let deltaTimeHex = decToHex(deltaTime);
    let data = 'ff'+deltaTimeHex;
    send_data_req(data,4,false,devEui);
  }
  else
  {
    logText = ': On the device with devEui '+devEui+' normal time, no time adjustment required';
    if ( config.debugMOD ) console.log ( moment().format('LLL'), logText);
  }
}
//Разбирает пакет с временем
function parsePackateTime ( data )
{
  data = data.toLowerCase()
  let result = {
    status: false
  };
  try
  {
    let bytes = [];
    for ( let i =0; i < data.length - 1; i = i + 2 )
    {
       bytes.push( data.substring( i, i + 2 ) );
    }
    if ( bytes[0] == 'ff' )
    {
      let validTime = bytes[4] !== undefined && bytes[3] !==undefined && bytes[2] !== undefined && bytes[1] !== undefined;
      if( validTime )
      {
        let hexTime = bytes[4] + bytes[3] + bytes[2] + bytes[1];
        let timeDevice = parseInt( hexTime, 16 );
        if( !isNaN( timeDevice ) )
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
    console.error( moment().format('LLL')+': ERROR parse packate time', e );
  }
  finally
  {
    return result;
  }
}
//------------------------------------------------------------------------------
//ws send message
//------------------------------------------------------------------------------
//Отправка команды на авторизацию
function auth_req ()
{
  let message = {
    cmd: 'auth_req',
    login: config.loginWS,
    password: config.passwordWS
  };
  ws.send_json( message );
  return;
}
function send_data_req( data, port, ack, devEui )
{
  let message = {
      cmd: 'send_data_req',
      data_list: [
        {
          devEui: devEui,
          data: data,
          port: parseInt( port ),
          ack: ack
        }
      ]
  };
  ws.send_json( message );
  return;
}
//------------------------------------------------------------------------------
//commands iotvega.com
//------------------------------------------------------------------------------
//Обработчик пакта rx
function rx ( obj )
{
  if ( !( obj.type && ( obj.type === 'UNCONF_UP' || obj.type === 'CONF_UP' ) ) ) return;
  try
  {
    let timeServerMs = obj.ts;
    let data = obj.data;
    let devEui = obj.devEui;
    let port = obj.port;
    if ( data && port == PORT_PACKATE_TIME )
    {
      let packateTime = parsePackateTime( data );
      let currentTime = moment().utc().unix();
      if(history[devEui] === undefined) history[devEui] = 0;
      let deltaTime = currentTime - history[devEui];
      console.log(Math.abs( deltaTime ),'-------',RX_DELAY);
      if( packateTime.status && Math.abs( deltaTime ) > RX_DELAY )
      {
        adjustTime( packateTime.time, devEui );
      }
      else
      {
        console.log( moment().format('LLL'),  ': device with devEui '+devEui+' denied time adjust. Reason: TimeCorrector send a time correct packate '+moment.unix(history[devEui]).format('LLL'));
      }
    }
  }
  catch (e)
  {
    console.error( moment().format('LLL'), e );
  }
  finally
  {
    return;
  }
}
//Обработчик пакета с результатом авторизации
function auth_resp ( obj )
{
  let logText = '';
  if ( obj.status )
  {
    for ( let i = 0; i < obj.command_list.length; i++ )
    {
      premission[ obj.command_list[i] ] = true;
    }
    statusAuth = true;
    logText = ': Success authorization on server iotvega';
    if( !premission['send_data'] )
    {
      logText = ': Attention!!! The user does not have sufficient rights to adjust the time. You must have rights to send data (command "send_data_req")';
    }

  }
  else
  {
    statusAuth = false;
    logText = ': Not successful authorization on server iotvega';
    setTimeout(()=>{
      ws.reload();
    },10000);
  }
  console.log( moment().format('LLL'), logText );
}
//Обработчик события, изменения данных пользователя
function alter_user_resp ( obj )
{
  ws.reload();
}
//Обработчик пакета результата отправки данных на устройство
function send_data_resp(obj)
{
  for ( let i = 0; i < obj.append_status.length; i++ )
  {
    if ( obj.append_status[i].status )
    {
      if ( config.debugMOD ) console.log( moment().format('LLL'), ': The time on device '+obj.append_status[i].devEui+' has been successfully adjusted');
    }
    else
    {
      if ( config.debugMOD ) console.log( moment().format('LLL'), ': The time on device '+obj.append_status[i].devEui+' has not been adjusted');
    }
  }
}
//Обработчик события ping
function ping()
{
  if ( config.debugMOD ) console.log( moment().format('LLL'), ': Ping');
}
//------------------------------------------------------------------------------
//initalization app
//------------------------------------------------------------------------------
//Инициализация WebSocket
function initWS ()
{
  ws = new VegaWS ( config.ws );
  ws.on( 'run', auth_req );
  ws.on( 'auth_resp', auth_resp );
  ws.on( 'rx', rx );
  ws.on( 'alter_user_resp', alter_user_resp );
  ws.on( 'send_data_resp', send_data_resp );
  ws.on( 'ping', ping );
}
//Запуск работы приложения
function run ( conf )
{
  config = conf;
  if ( config.valid() )
  {
    try
    {
      initWS();
    }
    catch ( e )
    {
      console.log( moment().format('LLL'), ': Initializing the application was a mistake' );
      console.error( e );
    }
  }
  return;
}
module.exports.config = config;
module.exports.run = run;
