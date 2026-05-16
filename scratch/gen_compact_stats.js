
const fs = require('fs');

// 2025년 가상 데이터 기반 압축 통계 생성
const SITES = ["H1", "16L", "17L", "V1L", "DSR", "미래기술캠퍼스", "SR1", "SR3", "6L", "sdr", "미캠"];
const MEALS = ["조식", "중식", "석식", "야식"];

function generateCompact2025() {
    const compact = {
        meta: { year: 2025, source: "Synthetic-Baseline" },
        holidays: {
            "01-01": "신정", "01-28": "설날", "01-29": "설날", "01-30": "설날",
            "03-01": "삼일절", "05-05": "어린이날", "05-06": "석탄일", "06-06": "현충일",
            "08-15": "광복절", "10-03": "개천절", "10-05": "추석", "10-06": "추석",
            "10-07": "추석", "10-09": "한글날", "12-25": "성탄절"
        },
        stats: {}
    };

    SITES.forEach(site => {
        compact.stats[site] = {};
        MEALS.forEach(meal => {
            let base = 800;
            if (site === "H1") base = 900;
            if (site === "DSR") base = 1200;
            const mealWeight = { "조식": 0.7, "중식": 1.2, "석식": 0.9, "야식": 0.4 }[meal];
            
            // 월별 가중치 (계절성)
            compact.stats[site][meal] = [
                0.95, 0.98, 1.05, 1.10, 1.12, 1.08, 0.95, 0.82, 1.02, 1.08, 1.10, 0.92
            ].map(w => Math.round(base * mealWeight * w));
        });
    });

    return compact;
}

const compactData = generateCompact2025();
fs.writeFileSync('frontend/assets/js/10-historical-stats.js', 
    `window._historicalStats2025 = ${JSON.stringify(compactData, null, 2)};`);
console.log("Generated compact historical stats (under 10KB).");
