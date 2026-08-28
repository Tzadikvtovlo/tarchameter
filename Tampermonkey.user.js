// ==UserScript==
// @name         tarchameter
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  תוסף צד-לקוח בלבד: מחשב יחס פוסט-מוניטין ומציג דרגות משתמשים באוצריא
// @author       [חבקוק](https://otzaria.org/forum/user/%D7%97%D7%91%D7%A7%D7%95%D7%A7)
// @match        https://otzaria.org/*
// @match        https://*.otzaria.org/*
// @updateURL    https://raw.githubusercontent.com/Tzadikvtovlo/tarchameter/main/Tampermonkey.user.js
// @downloadURL  https://raw.githubusercontent.com/Tzadikvtovlo/tarchameter/main/Tampermonkey.user.js
// @icon         https://www.google.com/s2/favicons?sz=64&domain=otzaria.org
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // נתיב הבסיס של הפורום (NodeBB יושב תחת /forum)
    const BASE = location.pathname.startsWith('/forum') ? '/forum' : '';

    // 1. עיצוב תגיות הדרגה
    GM_addStyle(`
        .otzaria-rank-badge {
            display: inline-flex !important;
            align-items: center !important;
            gap: 4px !important;
            font-size: 11px !important;
            font-weight: bold !important;
            padding: 2px 8px !important;
            border-radius: 10px !important;
            margin-right: 6px !important;
            margin-left: 6px !important;
            cursor: pointer !important;
            direction: rtl !important;
            vertical-align: middle !important;
            line-height: 1.4 !important;
            box-shadow: 0 1px 2px rgba(0,0,0,0.08) !important;
            user-select: none !important;
        }
        .rank-tier-new { background-color: #f1f5f9; color: #64748b; border: 1px solid #cbd5e1; }
        .rank-tier-bronze { background-color: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
        .rank-tier-silver { background-color: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
        .rank-tier-gold { background-color: #fefce8; color: #a16207; border: 1px solid #fef08a; }
        .rank-tier-diamond { background-color: #faf5ff; color: #7e22ce; border: 1px solid #e9d5ff; }
    `);

    // מטמון מקומי בזיכרון הדפדפן
    const memoryCache = new Map();

    // 2. נוסחת הדירוג המשוקללת
    function calculateScore(posts, rep) {
        if (!posts || posts <= 0) return 0;

        // מקדם החלקה - מעניש מדגם קטן (למשל פוסט 1 עם 10 מוניטין יקבל ציון נמוך)
        const DAMPING = 15;
        const smoothedRatio = rep / (posts + DAMPING);

        // מכפיל ותק וכמות פוסטים - נותן יתרון מוצדק למשתמשים יציבים עם מאות/אלפי פוסטים
        const volumeFactor = Math.log10(posts + 10);

        return Number((smoothedRatio * volumeFactor * 10).toFixed(1));
    }

    // 3. הגדרת דרגות
    function getRank(score, posts) {
        if (posts < 5) {
            return { title: 'משתמש חדש', icon: '🌱', cls: 'rank-tier-new' };
        }
        if (score < 8) {
            return { title: 'חבר פעיל', icon: '🥉', cls: 'rank-tier-bronze' };
        } else if (score < 18) {
            return { title: 'תורם מוערך', icon: '🥈', cls: 'rank-tier-silver' };
        } else if (score < 32) {
            return { title: 'מומחה קהילה', icon: '🥇', cls: 'rank-tier-gold' };
        } else {
            return { title: 'אגדת פורום', icon: '💎', cls: 'rank-tier-diamond' };
        }
    }

    // 4. שליפת נתוני המשתמש מה-API של NodeBB
    async function getUserStats(userslug) {
        if (memoryCache.has(userslug)) return memoryCache.get(userslug);

        // בדיקה ב-localStorage של הדפדפן
        const cached = localStorage.getItem('otz_rank_' + userslug);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                // תוקף מטמון מקומי: שעתיים
                if (Date.now() - parsed.timestamp < 1000 * 60 * 120) {
                    memoryCache.set(userslug, parsed.data);
                    return parsed.data;
                }
            } catch (e) {}
        }

        try {
            const res = await fetch(`${BASE}/api/user/${encodeURIComponent(userslug)}`);
            if (!res.ok) return null;

            const data = await res.json();
            const posts = parseInt(data.postcount || 0);
            const rep = parseInt(data.reputation || 0);

            const score = calculateScore(posts, rep);
            const rank = getRank(score, posts);
            const stats = { posts, rep, score, rank };

            // שמירה מקומית בדפדפן
            memoryCache.set(userslug, stats);
            localStorage.setItem('otz_rank_' + userslug, JSON.stringify({ timestamp: Date.now(), data: stats }));

            return stats;
        } catch (e) {
            return null;
        }
    }

    // 5. חילוץ ה-userslug מתוך הקישור
    function parseUsernameFromLink(userLink) {
        if (userLink.dataset.username) return userLink.dataset.username;

        const href = userLink.getAttribute('href') || '';
        const cleanPath = href.split('?')[0].split('#')[0];
        const segments = cleanPath.split('/').filter(Boolean);

        // הקישורים ב-NodeBB הם בצורת /forum/user/<userslug>
        const userIdx = segments.indexOf('user');
        if (userIdx !== -1 && segments[userIdx + 1]) {
            return decodeURIComponent(segments[userIdx + 1]);
        }

        // fallback: המרת שם התצוגה ל-slug (רווחים -> מקפים)
        return userLink.textContent.trim().replace(/^@/, '').replace(/\s+/g, '-');
    }

    // 6. הזרקת התגית ליד שם המשתמש בדף
    async function enhanceUserElement(userLink) {
        if (userLink.dataset.rankProcessed) return;
        userLink.dataset.rankProcessed = "true";

        const userslug = parseUsernameFromLink(userLink);
        if (!userslug || userslug.length > 35) return;

        const stats = await getUserStats(userslug);
        if (!stats) return;

        if (!userLink.parentNode || userLink.parentNode.querySelector('.otzaria-rank-badge')) return;

        const badge = document.createElement('span');
        badge.className = `otzaria-rank-badge ${stats.rank.cls}`;
        badge.innerHTML = `${stats.rank.icon} ${stats.rank.title}`;

        const rawRatio = stats.posts > 0 ? (stats.rep / stats.posts).toFixed(2) : 0;
        badge.title = `נתוני משתמש:\n• סה"כ פוסטים: ${stats.posts}\n• סה"כ מוניטין: ${stats.rep}\n• יחס גולמי: ${rawRatio}\n• ציון משוקלל: ${stats.score}`;

        userLink.insertAdjacentElement('afterend', badge);
    }

    // 7. סריקת הדף ומעקב אחרי גלילה וטעינת פוסטים חדשים
    function scanPage() {
        const userSelectors = [
            'a[href*="/user/"]:not([data-rank-processed]):not(.plugin-mentions-a)',
            '[component="user/link"]:not([data-rank-processed])'
        ];

        document.querySelectorAll(userSelectors.join(',')).forEach(el => {
            // הימנעות מתמונות פרופיל/אוואטרים
            if (el.querySelector('img') && el.textContent.trim() === '') return;
            enhanceUserElement(el);
        });
    }

    // הפעלה ראשונית והאזנה לשינויים בדף (SPA)
    scanPage();

    // debounce קל כדי לא להציף בסריקות בזמן רינדור
    let scanTimer = null;
    const observer = new MutationObserver(() => {
        if (scanTimer) return;
        scanTimer = setTimeout(() => {
            scanTimer = null;
            scanPage();
        }, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });

})();
