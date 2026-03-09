// ==UserScript==
// @name         Geizhals CPU benchmark Scores
// @namespace    geihhals_cpu_benchmark_scores
// @version      1.0
// @description  Adds CPU benchmark scores from CPUBenchmark to Geizhals product listings
// @match        https://geizhals.de/*
// @grant        GM_xmlhttpRequest
// @connect      cpubenchmark.net
// ==/UserScript==

(async function() {
    'use strict';

    // don't run unless on the notebook page
    if (new URLSearchParams(window.location.search).get("cat") !== "nb") return;

    const gradient = [
        [0, "darkred"],
        [30, "darkred"],
        [60, "yellow"],
        [80, "green"],
        [100, "darkgreen"]
    ];

    function parseColor(colorName) {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = colorName;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2]];
    }

    const gradientPoints = gradient.map(([k, c]) => [k, parseColor(c)]);
    const minScore = Math.min(...gradientPoints.map((k, c) => k[0]));
    const maxScore = Math.max(...gradientPoints.map((k, c) => k[0]));

    function scoreToColor(score) {
        score = Math.max(minScore, Math.min(maxScore, score));

        let start = gradientPoints[0], end = gradientPoints[gradientPoints.length - 1];

        for (let i = 0; i < gradientPoints.length - 1; i++) {
            if (score >= gradientPoints[i][0] && score <= gradientPoints[i + 1][0]) {
                start = gradientPoints[i];
                end = gradientPoints[i + 1];
                break;
            }
        }

        const range = end[0] - start[0];
        const t = range === 0 ? 0 : (score - start[0]) / range;

        const r = Math.round(start[1][0] + (end[1][0] - start[1][0]) * t);
        const g = Math.round(start[1][1] + (end[1][1] - start[1][1]) * t);
        const b = Math.round(start[1][2] + (end[1][2] - start[1][2]) * t);

        return `rgb(${r},${g},${b})`;
    }


    const CPU_SCORES = new Map();

    function ignoreField(field) {
        return field.includes("GB") ||
            field.includes("TB") ||
            field === "DE";
    }

    function extractCpuFromProduct(product) {
        const title = product.querySelector("h3");
        if (title) {
            let parts = title.textContent.split(",").map(p => p.trim());

            // inject vendor-prefixed variants
            for (let i = 0; i < parts.length; i++) {
                const p = parts[i].toLowerCase();

                if (p.startsWith("core ")) {
                    parts.splice(i + 1, 0, "intel " + parts[i]);
                    i++; // skip the inserted element
                } else if (p.startsWith("ryzen ")) {
                    parts.splice(i + 1, 0, "amd " + parts[i]);
                    i++;
                }
            }

            for (const part of parts) {
                if (ignoreField(part)) continue;

                const key = normalizeName(part);

                if (CPU_SCORES.has(key)) {
                    return key;
                }
            }
        }

        const description = product.querySelector(".productlist__description");
        if (description) {
            const text = description.textContent;

            const m = text.match(/CPU:\s*([^,]+)/i); // until next comma
            if (m) {
                let cpuText = m[1].trim();

                // build candidate variants like before
                let parts = [cpuText];

                const lower = cpuText.toLowerCase();
                if (lower.startsWith("core ")) {
                    parts.push("intel " + cpuText);
                } else if (lower.startsWith("ryzen ")) {
                    parts.push("amd " + cpuText);
                }

                for (const part of parts) {
                    const key = normalizeName(part);
                    if (CPU_SCORES.has(key)) {
                        return key;
                    }
                }

                // fallback: match known models inside the cpu text
                const normalizedCpuText = cpuText.toLowerCase();
                for (const model of CPU_SCORES.keys()) {
                    if (normalizedCpuText.includes(model)) {
                        return model;
                    }
                }
            }
        }


        console.log(product);
        return null;
    }

    // Function to update Geizhals listings
    function processProducts() {
        let bestScoreOnPage = 0;

        document.querySelectorAll(".productlist__product").forEach(product => {
            const cpu = extractCpuFromProduct(product);
            if (!cpu) return;

            const score = CPU_SCORES.get(cpu);
            if (score > bestScoreOnPage) bestScoreOnPage = score;
        });


        document.querySelectorAll(".productlist__product").forEach(product => {
            if (product.dataset.cpuScoreDone) return;

            const cpu = extractCpuFromProduct(product);
            if (!cpu) return;

            const foundScore = CPU_SCORES.get(cpu);

            const meta = product.querySelector(".cell.productlist__metascore");
            if (!meta) return;

            const span = document.createElement("span");

            const displayedScore = (foundScore / bestScoreOnPage) * 100;

            span.textContent = `CPU score: ${displayedScore.toFixed(0)}% (${cpu})`;
            span.style.color = scoreToColor(displayedScore);

            meta.prepend(span);
            product.dataset.cpuScoreDone = "1";
        });

    }

    // Helper to make GM_xmlhttpRequest return a Promise
    function makeGetRequest(url, headers = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                headers,
                onload: response => {
                    if (response.status >= 200 && response.status < 300) {
                        resolve(response.responseText);
                    } else {
                        reject({status: response.status, responseText: response.responseText});
                    }
                },
                onerror: error => reject(error)
            });
        });
    }

    async function load_cpu_json_data() {
        try {
            // load cpu data webpage, set session cookie
            const megaPageText = await makeGetRequest("https://www.cpubenchmark.net/CPU_mega_page.html");
            // fetch CPU JSON
            const jsonText = await makeGetRequest("https://www.cpubenchmark.net/data/", {'X-Requested-With': 'XMLHttpRequest'});
            return JSON.parse(jsonText);
        } catch (e) {
            console.error("Failed to load CPU JSON data:", e);
            return null;
        }
    }

    const json = await load_cpu_json_data();
    const cpus = json.data.filter(e => e.name && e.cpumark && e.thread).map(e => ({
        name: e.name,
        cpumark: parseInt(e.cpumark.replace(/,/g,''), 10),
        thread: parseInt(e.thread.replace(/,/g,''), 10)
    }))
    .filter(e => !isNaN(e.cpumark) && !isNaN(e.thread));

    const maxCPU = Math.max(...cpus.map(c => c.cpumark));
    const maxThread = Math.max(...cpus.map(c => c.thread));


    function normalizeName(name) {
        let n = name.toLowerCase();

        // remove additions
        n = n.split('@')[0];
        n = n.split('with')[0];

        // special handling for Snapdragon CPUs
        if (n.toLowerCase().includes("snapdragon")) {
            // match X1, X1P, X1E followed by any combination of letters/digits/dashes
            const m = n.match(/\b(x1[e|p]?)[-\s]?([0-9a-z\-]+)/i);
            if (m) {
                const prefix = m[1].toLowerCase();       // x1, x1p, x1e
                const code = m[2].toLowerCase().replace('-', '');
                return `snapdragon ${prefix}-${code}`;
            }

            // fallback for Snapdragon family names like "Snapdragon 7c"
            const m2 = n.match(/snapdragon\s+[0-9a-z]+/i);
            if (m2) return m2[0].toLowerCase();
        }

        return n.trim();
    }

    const BLACKLIST = new Set(["qualcomm"]);

    cpus.forEach(c => {
        const name = normalizeName(c.name);

        if (BLACKLIST.has(name)) return;

        const relative = ((c.cpumark / maxCPU) + (c.thread / maxThread)) / 2;
        CPU_SCORES.set(name, relative * 100);
    });



    // Initial processing
    processProducts();

    // Observe dynamic content (infinite scroll)
    const observer = new MutationObserver(processProducts);
    observer.observe(document.body, { childList: true, subtree: true });
})();
