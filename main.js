/**
 * Adaptive News Scraper Actor
 * 
 * This actor scrapes news items from various dynamic news sites,
 * automatically detecting and extracting title, link, date, and summary
 * for each news item without requiring manual configuration.
 */

const { Actor } = require('apify');
const { PlaywrightCrawler, Dataset } = require('crawlee');
const { detectArticles } = require('./lib/article-detector');
const { extractArticleData, extractWithReadability } = require('./lib/content-extractor');

// Initialize the Actor
Actor.main(async () => {
    // Get input from the user
    const input = await Actor.getInput();
    console.log('Input:', input);

    if (!input || !input.url) {
        throw new Error('Input must contain a "url" field!');
    }

    const { url, maxItems = 0, waitTime = 10 } = input;
    console.log(`Starting adaptive scraper for URL: ${url}`);
    console.log(`Maximum items to extract: ${maxItems || 'unlimited'}`);
    console.log(`Wait time for dynamic content: ${waitTime} seconds`);

    // Initialize the dataset to store results
    const dataset = await Dataset.open();
    let extractedCount = 0;
    let methodsUsed = new Set();

    // Create a PlaywrightCrawler instance
    const crawler = new PlaywrightCrawler({
        // Use headless browser for production
        launchContext: {
            launchOptions: {
                headless: true,
            },
        },

        // This function will be called for each URL
        async requestHandler({ page, request, enqueueLinks, log }) {
            log.info(`Processing ${request.url}...`);

            // Wait for the page to load completely
            await page.waitForLoadState('networkidle', { timeout: waitTime * 1000 });
            
            // Additional wait time for dynamic content
            log.info(`Waiting ${waitTime} seconds for dynamic content to load...`);
            await page.waitForTimeout(waitTime * 1000);

            // Get the HTML content of the page
            const html = await page.content();
            
            // Detect article elements
            log.info('Detecting article elements...');
            const detectedArticles = await page.evaluate((html) => {
                // This runs in the browser context
                // We need to stringify the result to pass it back
                const { detectArticles } = require('./lib/article-detector');
                return JSON.stringify(detectArticles(html));
            }, html);
            
            const articles = JSON.parse(detectedArticles);
            log.info(`Detected ${articles.length} potential article elements`);
            
            // Extract data from each article
            const newsItems = [];
            const baseUrl = request.url;
            
            // Track which detection methods were used
            const usedMethods = new Set();
            
            // Process each detected article
            for (let i = 0; i < articles.length; i++) {
                if (maxItems > 0 && newsItems.length >= maxItems) {
                    break;
                }
                
                const article = articles[i];
                log.info(`Extracting data from article ${i+1}/${articles.length} (confidence: ${article.confidence.toFixed(2)}, method: ${article.method})`);
                
                // Extract data using the content extractor
                const articleData = await page.evaluate((articleSelector, html, baseUrl) => {
                    // This runs in the browser context
                    const { extractArticleData } = require('./lib/content-extractor');
                    const element = document.querySelector(articleSelector);
                    if (!element) return null;
                    return extractArticleData(html, element, baseUrl);
                }, article.selector, html, baseUrl);
                
                if (articleData && articleData.title && articleData.link) {
                    newsItems.push(articleData);
                    usedMethods.add(article.method);
                    
                    // Add methods to the global set
                    Object.values(articleData.methods).forEach(method => {
                        methodsUsed.add(method);
                    });
                }
            }
            
            // If no articles were detected or extracted, try Readability as a fallback
            if (newsItems.length === 0) {
                log.info('No articles detected, trying Readability as fallback...');
                
                const readabilityData = await page.evaluate((html, url) => {
                    const { extractWithReadability } = require('./lib/content-extractor');
                    return extractWithReadability(html, url);
                }, html, baseUrl);
                
                if (readabilityData && readabilityData.title) {
                    newsItems.push(readabilityData);
                    methodsUsed.add('readability');
                }
            }
            
            // Log the number of extracted items
            log.info(`Successfully extracted ${newsItems.length} news items`);
            log.info(`Methods used: ${Array.from(usedMethods).join(', ')}`);
            
            // Save the results to the dataset
            await dataset.pushData(newsItems);
            extractedCount += newsItems.length;

            // Check if we've reached the maximum number of items
            if (maxItems > 0 && extractedCount >= maxItems) {
                log.info(`Reached maximum number of items (${maxItems}), stopping the crawler.`);
                await crawler.stop();
            }
        },

        // This function is called if the page processing fails
        failedRequestHandler({ request, error, log }) {
            log.error(`Request ${request.url} failed:\n${error}`);
        },
    });

    // Start the crawler with the provided URL
    await crawler.run([url]);

    // Get the results from the dataset
    const results = await dataset.getData();
    
    // Calculate success metrics
    const totalItems = results.items.flatMap(item => item).length;
    const itemsWithAllFields = results.items.flatMap(item => item).filter(
        item => item.title && item.link && item.date && item.summary
    ).length;
    
    const successRate = totalItems > 0 ? itemsWithAllFields / totalItems : 0;
    
    // Prepare the output
    const output = {
        newsItems: results.items.flatMap(item => item),
        totalCount: totalItems,
        url: url,
        extractionStats: {
            methodsUsed: Array.from(methodsUsed),
            successRate: successRate,
            completeItems: itemsWithAllFields,
            partialItems: totalItems - itemsWithAllFields
        }
    };

    // Store the output
    await Actor.pushData(output);
    console.log('Scraping finished successfully!');
});
