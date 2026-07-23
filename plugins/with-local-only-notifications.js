const { withExpoPlist, IOSConfig } = require('expo/config-plugins');
const fs = require('fs');
const plist = require('plist');

const withLocalOnlyNotifications = (config) => {
  return withExpoPlist(config, (config) => {
    const entitlementsPath = IOSConfig.Paths.getEntitlementsPath(config.modRequest.projectRoot);
    if (entitlementsPath && fs.existsSync(entitlementsPath)) {
      const parsed = plist.parse(fs.readFileSync(entitlementsPath, 'utf8'));
      if (parsed && parsed['aps-environment']) {
        delete parsed['aps-environment'];
        fs.writeFileSync(entitlementsPath, plist.build(parsed));
      }
    }
    return config;
  });
};

module.exports = withLocalOnlyNotifications;
