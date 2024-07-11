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

async function readCsv(inputFile) {
    const results = [];
    const parser = fs.createReadStream(inputFile).pipe(csvParse.parse({
        columns: true,
        delimiter: ",",
        trim: true,
        skip_empty_lines: true
    }));

    for await (const record of parser) {
        results.push(record);
    }
    return results;
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

async function processPin(browser, row, location, retries = 3) {
    const url = row.url;
    let tries = 0;
    let success = false;

    
    while (tries <= retries && !success) {
        const page = await browser.newPage();

        try {
            await page.goto(url, { timeout: 60000 });

            const mainCard = await page.$("div[data-test-id='CloseupDetails']");
            let website = "n/a";
            const websiteHolder = await page.$("span[style='text-decoration: underline;']");
            if (websiteHolder) {
                website = await page.evaluate(element => element.textContent, websiteHolder);
            }

            const starDivs = await page.$$("div[data-test-id='rating-star-full']");
            const stars = starDivs.length;

            
            const profileInfoDiv = await mainCard.$("div[data-test-id='follower-count']");
            if (profileInfoDiv === null) {
                throw new Error("Page failed to loaded, most likely blocked!");
            }

            const profileText = await page.evaluate(element => element.textContent, profileInfoDiv);

            const accountNameDiv = await profileInfoDiv.$("div[data-test-id='creator-profile-name']");
            const nestedDiv = await accountNameDiv.$("div");
            const accountName = await page.evaluate(element => element.getAttribute("title"), nestedDiv);

            const followerCount = profileText.replace(accountName, "").replace(" followers", "");

            const pinData = {
                name: accountName,
                website: website,
                stars: stars,
                follower_count: followerCount,
                image: row.image
            }
                
            console.log(pinData);
                

            success = true;
        } catch (err) {
            await page.screenshot({path: "ERROR.png"});
            console.log(`Error: ${err}, tries left: ${retries-tries}, url: ${url}`);
            tries++;
        } finally {
            await page.close();
        }
    } 
}

async function processResults(csvFile, location, concurrencyLimit, retries) {
    const pins = await readCsv(csvFile);
    const browser = await puppeteer.launch();

    for (const pin of pins) {
        await processPin(browser, pin, location, location, retries)
    }
    await browser.close();

}

async function main() {
    const keywords = ["grilling"];
    const concurrencyLimit = 4;
    const location = "uk";
    const retries = 3;
    const aggregateFiles = [];

    for (const keyword of keywords) {
        console.log("Crawl starting");
        await startScrape(keyword, location, retries);
        console.log("Crawl complete");
        aggregateFiles.push(`${keyword.replace(" ", "-")}.csv`);
    }


    console.log("Starting scrape");
    for (const file of aggregateFiles) {
        await processResults(file, location, concurrencyLimit, retries);
    }
    console.log("Scrape complete");
}


main();