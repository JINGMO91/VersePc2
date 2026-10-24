// launch-actions.js — data-action 注册
import { registerActions as registerActions } from '../../core/actions.js';
import { stopGameInstance } from './launch-runtime.js';
import { cancelLaunchFlow } from './launch-flow.js';
import { openVersionSettingsForRepair } from './launch-modal.js';
import { exportGameLog } from '../misc/console-log.js';

registerActions({
  stopGameInstance: (event, el, sessionId) => stopGameInstance(sessionId),
  cancelLaunchFlow,
  openVersionSettingsForRepair,
  exportGameLog,
});
