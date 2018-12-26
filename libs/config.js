//config.ini version 1.0.0
let moment = require('moment');
class Config
{
  constructor ()
  {
    this._ws = {
      url: 'ws://0.0.0.0:8002',
      login: 'root',
      password: '123'
    };
    this._system = {
      settings: {
        auto_update: false
      }
    };
    this._debugMOD = {
      status: false,
      settings: {}
    };
  }
  //setters-------------------------
  set ws_user ( val )
  {
    this._ws.login = val;
  }
  set ws_password ( val )
  {
    this._ws.password = val;
  }
  set ws_address ( val )
  {
    this._ws.url = val;
  }
  set other_debug_enabled ( val )
  {
    this._debugMOD.status = val;
  }
  //getters-------------------------
  get ws ()
  {
    return this._ws.url;
  }
  get loginWS ()
  {
    return this._ws.login.toString();
  }
  get passwordWS ()
  {
    return this._ws.password.toString();
  }
  get debugMOD ()
  {
    return this._debugMOD.status;
  }
  //methods
  setFromConfig ( config )
  {
    for ( let section in config )
    {
      try
      {
        for( let param in config[section] )
        {
          this[section+'_'+param] = config[section][param];
        }
      }
      catch ( e )
      {
        console.error( moment().format('LLL'), e );
        return false;
      }
    }
    return true;
  }
  valid ()
  {
    return true;
  }
}
module.exports = Config;
