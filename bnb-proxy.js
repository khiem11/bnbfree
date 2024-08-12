const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { DateTime } = require('luxon');
const colors = require('colors');
const { HttpsProxyAgent } = require('https-proxy-agent');

class Bnb {
    constructor() {
        this.authorizations = this.loadFile('data.txt');
        this.tokens = this.loadTokens('token.txt');
        this.payloads = this.loadFile('data.txt');
        this.proxies = this.loadProxies('proxy.txt');
    }

    loadFile(filename) {
        const filePath = path.resolve(__dirname, filename);
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        return fileContent.split('\n').map(line => line.trim()).filter(line => line);
    }

    loadTokens(filename) {
        const filePath = path.resolve(__dirname, filename);
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        return fileContent.split('\n').map(line => {
            const [xsrfToken, bnbfreeSession] = line.trim().split('|');
            return { xsrfToken, bnbfreeSession };
        }).filter(line => line.xsrfToken && line.bnbfreeSession);
    }

    loadProxies(filename) {
        const filePath = path.resolve(__dirname, filename);
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        return fileContent.split('\n').map(line => line.trim()).filter(line => line);
    }

    headers(authorization, xsrfToken, bnbfreeSession) {
        return {
            "Accept": "application/json, text/plain, */*",
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "Accept-Language": "en-US,en;q=0.9",
            "Authorization": authorization,
            "Cookie": `XSRF-TOKEN=${xsrfToken}; bnbfree_session=${bnbfreeSession}`,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
            "X-Xsrf-Token": xsrfToken,
            "Referer": "https://bnbfree.app/?tgWebAppStartParam=376905749",
            "Sec-Ch-Ua": `"Not/A)Brand";v="8", "Chromium";v="126", "Microsoft Edge";v="126"`,
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": `"Windows"`,
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "SAMEORIGIN",
        };
    }

    log(msg) {
        console.log(colors.green(`[*] ${msg}`));
    }

    async waitWithCountdown(seconds) {
        seconds = Math.floor(seconds);
        for (let i = seconds; i >= 0; i--) {
            process.stdout.write(colors.yellow(`\r[*] Chờ ${i} giây để tiếp tục...`));
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.log('');
    }

    async checkProxyIP(proxy) {
        try {
            const proxyAgent = new HttpsProxyAgent(proxy);
            const response = await axios.get('https://api.ipify.org?format=json', {
                httpsAgent: proxyAgent
            });
            if (response.status === 200) {
                return response.data.ip;
            } else {
                throw new Error(`Không thể kiểm tra IP của proxy. Status code: ${response.status}`);
            }
        } catch (error) {
            throw new Error(`Error khi kiểm tra IP của proxy: ${error.message}`);
        }
    }

    async startSession(authorization, xsrfToken, bnbfreeSession, payload, proxy) {
        const url = "https://bnbfree.app/start";
        const headers = this.headers(authorization, xsrfToken, bnbfreeSession);
        const agent = new HttpsProxyAgent(proxy);

        try {
            await axios.post(url, payload, { headers, httpsAgent: agent });
            this.log('Bắt đầu phiên thành công !');
        } catch (error) {
            this.log('Lỗi khi bắt đầu phiên');
        }
    }

    async claimBalance(authorization, xsrfToken, bnbfreeSession, proxy) {
        const url = "https://bnbfree.app/claim";
        const headers = this.headers(authorization, xsrfToken, bnbfreeSession);
        const agent = new HttpsProxyAgent(proxy);

        try {
            const response = await axios.post(url, {}, { headers, httpsAgent: agent });
            const { balance, miner } = response.data;
            let nextClaimTime;

            if (miner && miner.claimed_at) {
                nextClaimTime = DateTime.fromISO(miner.claimed_at).plus({ minutes: 6 });
            } else {
                nextClaimTime = DateTime.now().plus({ minutes: 6 });
            }

            this.log(`Claim thành công. Balance mới: ${balance}`);
            return { balance, nextClaimTime };
        } catch (error) {
            this.log('Lỗi khi claim balance');
            console.error(colors.red(error.response ? error.response.data : error.message));
            return null;
        }
    }

    async getUserData(no, authorization, xsrfToken, bnbfreeSession, proxy) {
        try {
            const ip = await this.checkProxyIP(proxy);
            console.log(colors.cyan(`========== Tài khoản ${no + 1} | IP: ${ip} ==========`));
        } catch (error) {
            console.log(colors.red(`Lỗi proxy: ${error.message}. Chuyển sang tài khoản tiếp theo.`));
            return null;
        }

        const url = "https://bnbfree.app/user";
        const headers = this.headers(authorization, xsrfToken, bnbfreeSession);
        const agent = new HttpsProxyAgent(proxy);

        try {
            const response = await axios.get(url, { headers, httpsAgent: agent });
            const { balance, miner } = response.data;

            let claimedAt;
            if (miner && miner.claimed_at) {
                claimedAt = DateTime.fromISO(miner.claimed_at).setZone('local').plus({ minutes: 6 });
            } else {
                claimedAt = DateTime.now().minus({ minutes: 1 });
            }
            this.log(`Balance: ${balance}`);
            const currentTime = DateTime.now();
            if (currentTime > claimedAt) {
                const claimResult = await this.claimBalance(authorization, xsrfToken, bnbfreeSession, proxy);
                if (claimResult) {
                    this.log(`Balance mới: ${claimResult.balance}`);
                    this.log(`Claim tiếp theo: ${claimResult.nextClaimTime.toLocaleString(DateTime.DATETIME_FULL)}`);
                    return claimResult.nextClaimTime;
                }
            } else {
                this.log(`Next Claim: ${claimedAt.toLocaleString(DateTime.DATETIME_FULL)}`);
                return claimedAt;
            }

            return null;
        } catch (error) {
            this.log('Lỗi khi lấy dữ liệu người dùng');
            console.error(colors.red(error.response ? error.response.data : error.message));
            return null;
        }
    }

    async main() {
        if (this.authorizations.length !== this.proxies.length) {
            console.error(colors.red('Số lượng proxy và số lượng tài khoản không khớp.'));
            process.exit(1);
        }
        let firstClaimTime;

        for (let i = 0; i < this.authorizations.length; i++) {
            const authorization = this.authorizations[i];
            const { xsrfToken, bnbfreeSession } = this.tokens[i];
            const payload = this.payloads[i];
            const proxy = this.proxies[i];

            await this.startSession(authorization, xsrfToken, bnbfreeSession, payload, proxy);
            const nextClaimTime = await this.getUserData(i, authorization, xsrfToken, bnbfreeSession, proxy);

            if (nextClaimTime && (!firstClaimTime || nextClaimTime < firstClaimTime)) {
                firstClaimTime = nextClaimTime;
            }
        }

        if (firstClaimTime) {
            const currentTime = DateTime.now();
            let waitTime = firstClaimTime.diff(currentTime).as('seconds');
            if (waitTime < 0) waitTime = 0;
            await this.waitWithCountdown(waitTime);
        }

        await this.main();
    }
}

if (require.main === module) {
    const bnb = new Bnb();
    bnb.main().catch(err => {
        console.error(colors.red(err));
        process.exit(1);
    });
}