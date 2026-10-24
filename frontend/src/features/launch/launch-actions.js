// launch-actions.js — data-action 注册
import { registerActions as registerActions } from '../../core/actions.js';
import { stopGameInstance } from './launch-runtime.js';

registerActions({
  stopGameInstance: (event, el, sessionId) => stopGameInstance(sessionId),
});
