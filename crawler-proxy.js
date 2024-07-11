const puppeteer = require("puppeteer");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const csvParse = require("csv-parse");
const fs = require("fs");

const API_KEY = JSON.parse(fs.readFileSync("config.json")).api_key;


async function writeToCsv(data, outputFile) {
    if (!data || data.length === 0) {
        throw new Error("No data to write!");
    }
    const fileExists = fs.existsSync(outputFile);

    const headers = Object.keys(data[0]).map(key => ({id: key, title: key}))

    const csvWriter = createCsvWriter({
        path: outputFile,
        header: headers,
        append: fileExists
    });
    try {
        await csvWriter.writeRecords(data);
    } catch (e) {
        throw new Error("Failed to write to csv");
    }
}

function getScrapeOpsUrl(url, location="us") {
    const params = new URLSearchParams({
        api_key: API_KEY,
        url: url,
        country: location,
        wait: 2000
    });
    return `https://proxy.scrapeops.io/v1/?${params.toString()}`;
}

async function scrapeSearchResults(browser, keyword, pageNumber, location="us", retries=3) {
    let tries = 0;
    let success = false;

    while (tries <= retries && !success) {
        
        const formattedKeyword = keyword.replace(" ", "+");
        const page = await browser.newPage();
        await page.setJavaScriptEnabled(false);

        try {

            const url = `https://www.pinterest.com/search/pins/?q=${formattedKeyword}&rs=typed`;
            const proxyUrl = getScrapeOpsUrl(url, location);
            await page.goto(proxyUrl);


            console.log(`Successfully fetched: ${url}`);

            const divCards = await page.$$("div[data-grid-item='true']");

            for (const divCard of divCards) {

                const aElement = await divCard.$("a");
                const name = await page.evaluate(element => element.getAttribute("aria-label"), aElement);
                const href = await page.evaluate(element => element.getAttribute("href"), aElement);
                const imgElement =  await divCard.$("img");
                const imgLink = await page.evaluate(element => element.getAttribute("src"), imgElement);

                
                const searchData = {
                    name: name,
                    url: `https://www.pinterest.com${href.replace("https://proxy.scrapeops.io", "")}`,
                    image: imgLink
                };

                await writeToCsv([searchData], `${keyword.replace(" ", "-")}.csv`);
            }


            success = true;
        } catch (err) {
            console.log(`Error: ${err}, tries left ${retries - tries}`);
            tries++;
        } finally {
            await page.close();
        } 
    }
}

async function startScrape(keyword, location, concurrencyLimit, retries) {

    const browser = await puppeteer.launch()

    await scrapeSearchResults(browser, keyword, location, retries);       

    await browser.close();
}


async function main() {
    const keywords = ["grilling"];
    const concurrencyLimit = 4;
    const location = "us";
    const retries = 3;
    const aggregateFiles = [];

    for (const keyword of keywords) {
        console.log("Crawl starting");
        await startScrape(keyword, location, retries);
        console.log("Crawl complete");
        aggregateFiles.push(`${keyword.replace(" ", "-")}.csv`);
    }

}


main();