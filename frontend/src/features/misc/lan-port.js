// 局域网端口探测：独立成模块，供联机与陶瓦联机流程共用，避免相互依赖。
import { API } from '../../core/api.js';
import { bridge } from '../../core/tauri-bridge.js';

export async function detectLanPort() {
    try {
        const gs = await API.getGameStatus();
        if (gs && gs.running && gs.lanPort) return gs.lanPort;
    } catch (e) {}
    try {
        const scanResult = await bridge.redstoneOnline.scanPort();
        if (scanResult && scanResult.ok && scanResult.port) return scanResult.port;
    } catch (e) {}
    return null;
}
