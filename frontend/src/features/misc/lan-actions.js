// lan-actions.js — data-action 注册
import { registerActions as registerActions } from '../../core/actions.js';
import { enderlinkCopyHall } from './lan-enderlink.js';

registerActions({
  enderlinkCopyHall: (event, el, addr) => enderlinkCopyHall(addr),
});
