//app.js version 1.0.1
const DELAY = 1;
const SECONDS_IN_DAY = 60 * 60 * 24;
const COUNT_BYTE_IN_PACKATE_TIME = 4;
const PORT_PACKATE_TIME = 4;
const RX_DELAY_SECOND = 60;
const ALLOWABLE_DIFFERENCE_SECONDS = 5;

let VegaWS = require("./vega_ws.js");
let moment = require("moment");
let Uint64BE = require("int64-buffer").Uint64BE;
const cron = require('node-cron');


let config = new Object();
let statusAuth = false;
let premission = new Object();
let ws = new Object();
let history = new Object();
//------------------------------------------------------------------------------
//Application logic
//------------------------------------------------------------------------------
//Функция конвертирующая десятичное целое число в HEX
function decToHex(dec) {
    try {
        let hex = new Uint64BE(dec).toString(16);
        let bytes = [];
        if (hex.length % 2 !== 0) {
            hex = "0" + hex;
        }
        for (let i = 0; i < hex.length - 1; i = i + 2) {
            let byte = hex.substring(i, i + 2);
            if (byte.length == 1) {
                byte = "0" + byte;
            }
            bytes.push(byte);
        }
        let lengthHex = COUNT_BYTE_IN_PACKATE_TIME * 2;
        while (bytes.length < lengthHex) {
            bytes.unshift("00");
        }
        bytes.reverse();
        hex = bytes.join("");
        return hex;
    } catch (e) {
        if (config.debugMOD) console.error(moment().format("LLL"), e);
        return "";
    }
}
//Корректирует время если это нужно
function adjustTime(deviceTime, devEui) {
    let logText = "";
    let currentTime = moment().utc().unix();
    let deltaTime = currentTime - (deviceTime - DELAY);
    if (Math.abs(deltaTime) > ALLOWABLE_DIFFERENCE_SECONDS) {
        history[devEui] = currentTime;
        logText =
            ": Need to adjust the time to " +
            deltaTime +
            " seconds, on the device with devEui " +
            devEui;
        if (config.debugMOD) console.log(moment().format("LLL"), logText);
        let deltaTimeHex = decToHex(deltaTime);
        let data = "ff" + deltaTimeHex;
        send_data_req(data, 4, false, devEui);
    } else {
        logText =
            ": On the device with devEui " +
            devEui +
            " normal time, no time adjustment required";
        if (config.debugMOD) console.log(moment().format("LLL"), logText);
    }
}
//Разбирает пакет с временем
function parsePackateTime(data) {
    data = data.toLowerCase();
    let result = {
        status: false,
    };
    try {
        let bytes = [];
        for (let i = 0; i < data.length - 1; i = i + 2) {
            bytes.push(data.substring(i, i + 2));
        }
        if (bytes[0] == "ff") {
            let validTime =
                bytes[4] !== undefined &&
                bytes[3] !== undefined &&
                bytes[2] !== undefined &&
                bytes[1] !== undefined;
            if (validTime) {
                let hexTime = bytes[4] + bytes[3] + bytes[2] + bytes[1];
                let timeDevice = parseInt(hexTime, 16);
                if (!isNaN(timeDevice)) {
                    result.time = timeDevice;
                    result.status = true;
                }
            }
        }
    } catch (e) {
        result.status = false;
        console.error(moment().format("LLL") + ": ERROR parse packate time", e);
    } finally {
        return result;
    }
}

// Utilities
function uuid() {
    return Math.floor(Math.random() * 32768);
}

//------------------------------------------------------------------------------
//ws send message
//------------------------------------------------------------------------------
//Отправка команды на авторизацию
function auth_req() {
    let message = {
        cmd: "auth_req",
        login: config.loginWS,
        password: config.passwordWS,
    };
    ws.send_json(message);
    return;
}
function send_data_req(data, port, ack, devEui) {
    let message = {
        cmd: "send_data_req",
        data_list: [
            {
                devEui: devEui,
                data: data,
                port: parseInt(port),
                ack: ack,
            },
        ],
    };
    ws.send_json(message);
    return;
}
//------------------------------------------------------------------------------
//commands iotvega.com
//------------------------------------------------------------------------------
//Обработчик пакта rx
function rx(obj) {
    if (!(obj.type && (obj.type === "UNCONF_UP" || obj.type === "CONF_UP")))
        return;
    try {
        let timeServerMs = obj.ts;
        let data = obj.data;
        let devEui = obj.devEui;
        let appEui = obj.appEui;
        let port = obj.port;
        if (data && port == PORT_PACKATE_TIME) {
            adjustTimeRegular(data, devEui);
        }
        if (data && isSpbzipResponse(appEui, port)) {
            handleSpbzip(devEui, data);
        }
    } catch (e) {
        console.error(moment().format("LLL"), e);
    } finally {
        return;
    }
}
function adjustTimeRegular(data, devEui) {
    let packateTime = parsePackateTime(data);
    let currentTime = moment().utc().unix();
    if (history[devEui] === undefined) history[devEui] = 0;
    let deltaTime = currentTime - history[devEui];
    if (packateTime.status && Math.abs(deltaTime) > RX_DELAY_SECOND) {
        adjustTime(packateTime.time, devEui);
    } else {
        console.log(
            moment().format("LLL"),
            ": device with devEui " +
                devEui +
                " denied time adjust. Reason: TimeCorrector send a time correct packate " +
                moment.unix(history[devEui]).format("LLL"),
        );
    }
}

//Обработчик пакета с результатом авторизации
function auth_resp(obj) {
    let logText = "";
    if (obj.status) {
        for (let i = 0; i < obj.command_list.length; i++) {
            premission[obj.command_list[i]] = true;
        }
        statusAuth = true;
        logText = ": Success authorization on server iotvega";
        if (!premission["send_data"]) {
            logText =
                ': Attention!!! The user does not have sufficient rights to adjust the time. You must have rights to send data (command "send_data_req")';
        }

        // Send SpbZIP request
        requestSpbzips();
    } else {
        statusAuth = false;
        logText = ": Not successful authorization on server iotvega";
        setTimeout(() => {
            ws.reload();
        }, 10000);
    }
    console.log(moment().format("LLL"), logText);
}
//Обработчик события, изменения данных пользователя
function alter_user_resp(obj) {
    ws.reload();
}
//Обработчик пакета результата отправки данных на устройство
function send_data_resp(obj) {
    for (let i = 0; i < obj.append_status.length; i++) {
        if (obj.append_status[i].status) {
            if (config.debugMOD)
                console.log(
                    moment().format("LLL"),
                    ": The time on device " +
                        obj.append_status[i].devEui +
                        " has been successfully adjusted",
                );
        } else {
            if (config.debugMOD)
                console.log(
                    moment().format("LLL"),
                    ": The time on device " +
                        obj.append_status[i].devEui +
                        " has not been adjusted",
                );
        }
    }
}
//Обработчик события ping
function ping() {
    if (config.debugMOD) console.log(moment().format("LLL"), ": Ping");
}

//------------------------------------------------------------------------------
// Хак для корректировки времени ЦЭ272Х
//------------------------------------------------------------------------------

// Запрос списка счётчиков СпбЗИП 2726/2727
function requestSpbzips() {
    const message = {
        cmd: "get_devices_req",
        select: {
            appEui_list: ["5350625A49503237", "5350625A4950574C"],
        },
    };

    console.log(moment().format("LLL"), "Requesting SpbZIP devices");
    ws.send_json(message);
}

// Очередь устройств на обработку
const devicesToProcess = [];

// Реакция на запрос устройств
/*
{
    "cmd": "get_devices_resp",
    "status": true",
    "devices_list": {
      "devEui": string,
    }[];
}
*/
function onGetDevices(obj) {
    if (!obj.status || !obj.devices_list) {
        console.log(
            moment().format("LLL"),
            "Failed to receive SpbZIP device list",
        );
        return;
    }

    const deviceList = obj.devices_list;
    const count = deviceList.length;
    if (count === 0) return;

    console.log(
        moment().format("LLL"),
        "Received SpbZIP device list, total devices:",
        count,
    );

    for (const device of deviceList) {
        const devEui = device.devEui;
        devicesToProcess.push(devEui);
    }
    startDeviceProcessing();
}

function startDeviceProcessing(){
    // Если нет доступных устройств для обработки, выходим
    if(devicesToProcess.length === 0){
        return; 
    }

    const devEui = devicesToProcess.pop();
    requestSpbZipSettings(devEui);
}

function requestSpbZipSettings(devEui){
    console.log(
        moment().format("LLL"),
        "Requesting advanced meter info from SpbZIP:",
        devEui,
    );

    const msg = Buffer.alloc(3);
    // 11 - Запрос конфигурации электросчётчика
    msg.writeUint8(11, 0);
    msg.writeUint16LE(uuid(), 1);
    send_data_req(msg.toString("hex"), 2, false, devEui);
}

const SpbzipAppEuis = new Set(["5350625A49503237", "5350625A4950574C"]);
function isSpbzipResponse(appEui, fPort) {
    if (fPort !== 2) {
        return false;
    }

    if (!SpbzipAppEuis.has(appEui)) {
        return false;
    }

    return true;
}

function parseSpbzip(hex) {
    const data = Buffer.from(hex, "hex");
    const type = data.readUint8(0);
    if (type === 7) {
        // Настройки счётчика
        return {
            type: "settings",
            addr: data.readUint32LE(1),
        };
    } else if (type === 2) {
        // Мгновенные показания
        return {
            type: "instant",
            time: data.readUInt32LE(5),
            uuid: data.readUint16LE(41),
        };
    } else {
        return {
            type: "unknown",
        };
    }
}

const uuidToAddr = new Map();
function handleSpbzip(devEui, data) {
    const parsed = parseSpbzip(data);
    if (parsed.type === "unknown") {
        return;
    }

    if (parsed.type === "settings") {
        // Мы получили настройки для получения сетевого адреса
        // по этому адресу запрашиваем мгновенные показания со временем уст-ва
        console.log(
            moment().format("LLL"),
            "Received SpbZIP",
            devEui,
            "settings:",
            parsed,
        );
        const addr = parsed.addr;
        const reqUuid = uuid();

        uuidToAddr.set(reqUuid, addr);

        const msg = Buffer.alloc(7);
        // 3 - Запрос мгновенных значений
        msg.writeUint8(3, 0);
        msg.writeUint32LE(addr, 1);
        msg.writeUint16LE(reqUuid, 5);

        console.log(
            moment().format("LLL"),
            "Sending time request to SpbZIP",
            devEui,
        );

        send_data_req(msg.toString("hex"), 2, false, devEui);
    } else if (parsed.type === "instant") {
        console.log(
            moment().format("LLL"),
            "Received SpbZIP",
            devEui,
            "time:",
            parsed,
        );

        const uuid = parsed.uuid;
        const addr = uuidToAddr.get(uuid);
        if (typeof addr === "undefined") {
            console.log(moment().format("LLL"), "Network address not found!");
            return;
        }
        uuidToAddr.delete(uuid);

        const deviceTime = parsed.time;
        const currentTime = moment().utc().unix();

        // Насколько текущее время больше времени устройства
        const deltaTime = currentTime - (deviceTime - DELAY);
        const diff = Math.abs(deltaTime);

        if (diff >= SECONDS_IN_DAY) {
            console.log(
                moment().format("LLL"),
                "Correction is to big SpbZIP",
                devEui,
                "seconds:",
                deltaTime,
                "need manual correction",
            );
            return;
        }
        if (diff < ALLOWABLE_DIFFERENCE_SECONDS) {
            console.log(
                moment().format("LLL"),
                "Time on SpbZIP",
                devEui,
                " is correct, no adjustment needed.",
            );
            return;
        }

        // Если deltaTime > 0, значит наше время впереди устройства и устройству нужно время добавить
        // Если deltaTime < 0, значит наше время позади устройства у устройства нужно время отнять
        const sign = deltaTime > 0 ? 1 : -1;

        const fullAdjustments = Math.floor(diff / 30);
        const smallAdjustment = diff % 30;

        console.log(
            moment().format("LLL"),
            "Correction needed for SpbZIP",
            devEui,
            "Packets needed to adjust:",
            fullAdjustments + 1,
        );

        const batch = [];

        for (let i = 0; i < fullAdjustments; i++) {
            batch.push({
                devEui: devEui,
                addr: addr,
                correction: sign * 30,
            });
        }
        if (smallAdjustment > 0) {
            batch.push({
                devEui: devEui,
                addr: addr,
                correction: sign * smallAdjustment,
            });
        }

        sendSpbzipCorrectionBatch(batch);
        startDeviceProcessing();
    }
}

function sendSpbzipCorrectionBatch(batch) {
    const data = Buffer.alloc(11);

    const data_list = batch.map(({ devEui, addr, correction }) => {
        data.writeUint8(1, 0);
        data.writeUint32LE(addr, 1);
        data.writeInt32LE(correction, 5);
        data.writeUint16LE(uuid(), 9);

        return {
            devEui: devEui,
            data: data.toString("hex"),
            port: 8,
            ack: false,
        };
    });

    let message = {
        cmd: "send_data_req",
        data_list: data_list,
    };
    ws.send_json(message);
}

//------------------------------------------------------------------------------
//initalization app
//------------------------------------------------------------------------------
//Инициализация WebSocket
function initWS() {
    ws = new VegaWS(config.ws);
    ws.on("run", auth_req);
    ws.on("auth_resp", auth_resp);
    ws.on("rx", rx);
    ws.on("alter_user_resp", alter_user_resp);
    ws.on("send_data_resp", send_data_resp);
    ws.on("ping", ping);
    ws.on("get_devices_resp", onGetDevices)
}

//Запуск работы приложения
function run(conf) {
    config = conf;
    if (config.valid()) {
        try {
            cron.schedule('0 0 * * 0', () => {
                // Запускает процесс опроса времени 
                requestSpbzips();
            });


            initWS();
        } catch (e) {
            console.log(
                moment().format("LLL"),
                ": Initializing the application was a mistake",
            );
            console.error(e);
        }
    }
    return;
}
module.exports.config = config;
module.exports.run = run;
