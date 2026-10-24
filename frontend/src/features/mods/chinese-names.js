/**
 * VersePC - Minecraft Launcher
 * Copyright (c) 2026 豆杰
 * SPDX-License-Identifier: GPL-3.0-only
 */

/**
 * mod-chinese-names.js - 模组中文名称映射表
 * ============================================================================
 * 为常用的 Minecraft 模组 ID 提供对应的中文名称/描述。
 *
 * 功能：
 * 1. 模组名查询 - getModChineseName(id) → 中文名
 * 2. 格式化展示 - formatModNameWithChinese(id, name) → "EnglishName（中文名）"
 *
 * 匹配策略（按优先级）：
 * 1. 精确匹配 modId → 中文名
 * 2. 精确匹配 englishName → 中文名
 * 3. 前两级路径部分匹配（处理带版本的ID如 fabric-api-0.92.0）
 * 4. 模糊匹配 - id 包含 key 或 key 包含 id
 *
 * 涵盖的模组类别：
 * - 优化类 (Sodium, Lithium, Phosphor, Starlight, FerriteCore...)
 * - API/库类 (ClothConfig, Architectury, GeckoLib, KotlinForForge...)
 * - 物品管理 (JEI, REI, Jade, HWYLA, WTHIT...)
 * - 地图 (JourneyMap, XaeroMinimap, XaeroWorldMap...)
 * - 科技 (Create, Mekanism, Thermal, AE2, Refined Storage...)
 * - 魔法 (Botania, BloodMagic, Thaumcraft, ArsNouveau...)
 * - 生物 (AlexMobs, MowzieMobs, TwilightForest...)
 * - 世界生成 (Terralith, BYG, BiomesOPlenty, YungBetter...)
 * - 装饰 (Macaw系列, Chipped, Quark, Supplementaries...)
 * - PvP/动作 (BetterCombat, EpicFight, Parcool...)
 * - 联动 (InControl, MobSpawning, ...)
 * - 食物 (PamHarvestcraft, FarmersDelight, Croptopia, ...)
 * - 服务器 (GriefPrevention, LuckPerms, Towny, WorldGuard, ...)
 * - 语音 (SimpleVoiceChat, PlasmaVoice, MumbleLink...)
 * - 工具 (WorldEdit, Litematica, Malilib...)
 */

import { MOD_SLUG_MAP } from './mod-slug-map.js';
import { MOD_CHINESE_NAMES_A } from './chinese-names-data-mods-a.js';
import { MOD_CHINESE_NAMES_B } from './chinese-names-data-mods-b.js';
import { MODPACK_CHINESE_NAMES } from './chinese-names-data-modpacks.js';
import { CHINESE_SEARCH_KEYWORDS, CHINESE_SEARCH_KEYWORDS_MODPACK } from './chinese-names-keywords.js';

export const MOD_CHINESE_NAMES = { ...MOD_CHINESE_NAMES_A, ...MOD_CHINESE_NAMES_B };
export { MODPACK_CHINESE_NAMES, CHINESE_SEARCH_KEYWORDS, CHINESE_SEARCH_KEYWORDS_MODPACK };

export function getModChineseName(modId, englishName) {
    if (!modId && !englishName) return '';

    const id = (modId || '').toLowerCase().replace(/[\s_]/g, '-');
    const name = (englishName || '').toLowerCase().replace(/[\s_]/g, '-');

    // 第1级：翻译数据库（8000+ 条，最权威）
    if (MOD_SLUG_MAP[id]) return MOD_SLUG_MAP[id];
    if (MOD_SLUG_MAP[name]) return MOD_SLUG_MAP[name];

    // 第2级：整合包翻译字典
    if (MODPACK_CHINESE_NAMES[id]) return MODPACK_CHINESE_NAMES[id];
    if (MODPACK_CHINESE_NAMES[name]) return MODPACK_CHINESE_NAMES[name];

    // 第3级：本地字典精确匹配
    if (MOD_CHINESE_NAMES[id]) return MOD_CHINESE_NAMES[id];
    if (MOD_CHINESE_NAMES[name]) return MOD_CHINESE_NAMES[name];

    // 第4级：本地字典前缀匹配（处理带版本号的ID，如 fabric-api-0.92.0 → fabric-api）
    const partialId = id.split('-').slice(0, 2).join('-');
    const partialName = name.split('-').slice(0, 2).join('-');
    if (MOD_CHINESE_NAMES[partialId]) return MOD_CHINESE_NAMES[partialId];
    if (MOD_CHINESE_NAMES[partialName]) return MOD_CHINESE_NAMES[partialName];

    // 第5级：本地字典模糊匹配（子串包含关系，仅限4字符以上的key避免误匹配）
    for (const [key, value] of Object.entries(MOD_CHINESE_NAMES)) {
        if (key.length < 4) continue;
        if (id.includes(key) || key.includes(id) || name.includes(key) || key.includes(name)) {
            return value;
        }
    }

    return '';
}

export function formatModNameWithChinese(modId, englishName) {
    const chineseName = getModChineseName(modId, englishName);
    if (chineseName) {
        return `${englishName}（${chineseName}）`;
    }
    return englishName;
}

export function translateChineseSearch(query, type) {
    if (!query) return '';
    const keywords = type === 'modpack' ? CHINESE_SEARCH_KEYWORDS_MODPACK : CHINESE_SEARCH_KEYWORDS;
    const q = query.trim();
    if (!q) return '';
    if (keywords[q]) return keywords[q].join(' ');
    for (const [cn, enList] of Object.entries(keywords)) {
        if (q.includes(cn) || cn.includes(q)) return enList.join(' ');
    }
    return '';
}

export function isChineseQuery(query) {
    if (!query) return false;
    return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(query);
}
