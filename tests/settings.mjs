/** Settings read back from whatever localStorage holds. */
import { checker, load } from '../tools/load.mjs';

const { check, done } = checker();
const S = await load('core/settings');

const defaults = S.defaultSettings();
check('nothing stored: defaults', S.readSettings(null), defaults);
check('not JSON: defaults', S.readSettings('{oops'), defaults);
check('not an object: defaults', S.readSettings('42'), defaults);
check('reduced motion starts calm', S.readSettings(null, true).calm, true);
check('a stored choice beats reduced motion', S.readSettings('{"calm":false}', true).calm, false);
check('all fields kept', S.readSettings(JSON.stringify({ volume: 0.3, muted: true, style: 'lofi', pattern: 4, pace: 'song', calm: true, showInfo: true })), {
  volume: 0.3, muted: true, style: 'lofi', pattern: 4, pace: 'song', calm: true, showInfo: true,
});
check('volume clamped', S.readSettings('{"volume": 7}').volume, 1);
check('broken fields become defaults', S.readSettings(JSON.stringify({ volume: 'loud', muted: 1, style: 'polka', pattern: 99, pace: 'often', calm: 'yes' })), defaults);
check('a fractional pattern is refused', S.readSettings('{"pattern": 1.5}').pattern, null);

done('settings');
