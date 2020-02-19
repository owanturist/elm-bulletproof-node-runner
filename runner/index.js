// eslint-disable-next-line node/no-missing-require
const Runner = require('Runner.elm');

const SETTINGS_KEY = 'bf_settings';

const { ports } = Runner.Elm.Runner.init({
    flags: localStorage.getItem(SETTINGS_KEY)
});

ports.save_settings.subscribe(settings => localStorage.setItem(SETTINGS_KEY, settings));
