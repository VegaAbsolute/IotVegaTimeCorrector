# IotVegaTimeCorrector
Application for automatic time correction on iotVegaServer devices
## Quick start

- Install node.js, [download](https://nodejs.org/en/download/)

- Make a clone of the repository IotVegaTimeCorrector `git clone https://github.com/VegaAbsolute/IotVegaTimeCorrector.git`

- Go to the Applications folder IotVegaTimeCorrector

- Configure IotVegaTimeCorrector. Edit the config.ini file.

- Install the application, in the IotVegaTimeCorrector folder, run the command `npm install`

- Run the application by using the command `npm start`

## Tips
1. To run the application in the background, try using "forever" or "pm2"

### using forever
- Installation forever `npm install forever -g`
- Running the application `forever start index.js`

### using pm2
- Installation forever `npm install pm2 -g`
- Running the application `pm2 start index.js`
- Save `pm2 save`

## Recommendations
- Use the unix operating system.
