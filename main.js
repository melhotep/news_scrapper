/**
 * Adaptive News Scraper Actor
 * 
 * This actor scrapes news items from various dynamic news sites,
 * automatically detecting and extracting title, link, date, and summary.
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

    const { url, maxItems = 0, waitTime = 20 } = input; // Increased default wait time
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

            try {
                // Wait for the page to load completely with increased timeout
                await page.waitForLoadState('networkidle', { timeout: waitTime * 1000 });
                
                // Additional wait time for dynamic content
                log.info(`Waiting ${waitTime} seconds for dynamic content to load...`);
                await page.waitForTimeout(waitTime * 1000);

                // Get the HTML content of the page
                const html = await page.content();
                
                // IMPORTANT FIX: Instead of using require in browser context,
                // we'll implement the detection logic directly here
                log.info('Detecting article elements...');
                
                // First approach: Look for article elements using CSS selectors
                const articles = await page.$$eval('article, .article, .news-item, .gc__content-container article', 
                    (elements) => {
                        return elements.map((el, index) => {
                            // Create a simple selector for this element
                            return {
                                element: index,
                                method: 'directSelector',
                                confidence: 0.9,
                                selector: `article:nth-child(${index + 1})`
                            };
                        });
                    }
                );
                
                log.info(`Detected ${articles.length} potential article elements`);
                
                // Extract data from each article
                const newsItems = [];
                const baseUrl = request.url;
                
                // Process each detected article
                for (let i = 0; i < articles.length; i++) {
                    if (maxItems > 0 && newsItems.length >= maxItems) {
                        break;
                    }
                    
                    const article = articles[i];
                    log.info(`Extracting data from article ${i+1}/${articles.length}`);
                    
                    // Extract data directly using selectors for Al Jazeera
                    const articleData = await page.evaluate((index) => {
                        // Find the article element
                        const articles = document.querySelectorAll('article, .article, .news-item, .gc__content-container article');
                        const element = articles[index];
                        
                        if (!element) return null;
                        
                        // Extract title and link
                        const titleElement = element.querySelector('.gc__title-link, h1, h2, h3, a[class*="title"], a[class*="headline"]');
                        const title = titleElement ? titleElement.textContent.trim() : null;
                        const link = titleElement && titleElement.href ? titleElement.href : null;
                        
                        // Extract date
                        const dateElement = element.querySelector('.gc__date, time, [class*="date"], [class*="time"]');
                        const date = dateElement ? dateElement.textContent.trim() : null;
                        
                        // Extract summary
                        const summaryElement = element.querySelector('.gc__excerpt, p, [class*="summary"], [class*="excerpt"], [class*="description"]');
                        const summary = summaryElement ? summaryElement.textContent.trim() : null;
                        
                        return {
                            title,
                            link,
                            date,
                            summary,
                            confidence: {
                                title: title ? 0.9 : 0,
                                link: link ? 0.9 : 0,
                                date: date ? 0.8 : 0,
                                summary: summary ? 0.8 : 0,
                                overall: title && link ? 0.85 : 0.5
                            },
                            methods: {
                                title: 'directSelector',
                                link: 'directSelector',
                                date: 'directSelector',
                                summary: 'directSelector'
                            }
                        };
                    }, article.element);
                    
                    if (articleData && articleData.title && articleData.link) {
                        newsItems.push(articleData);
                        methodsUsed.add('directSelector');
                    }
                }
                
                // If no articles were detected or extracted, try a more generic approach
                if (newsItems.length === 0) {
                    log.info('No articles detected with primary method, trying alternative approach...');
                    
                    // Try to find any elements that look like news items
                    const genericArticles = await page.$$eval('div.gc__content-container > div, .search-result, .search-results > div', 
                        (elements) => {
                            return elements.map((el, index) => {
                                return {
                                    element: index,
                                    method: 'genericSelector',
                                    confidence: 0.7,
                                    selector: `div:nth-child(${index + 1})`
                                };
                            });
                        }
                    );
                    
                    log.info(`Detected ${genericArticles.length} potential generic elements`);
                    
                    // Process each generic element
                    for (let i = 0; i < genericArticles.length; i++) {
                        if (maxItems > 0 && newsItems.length >= maxItems) {
                            break;
                        }
                        
                        const article = genericArticles[i];
                        
                        // Extract data using generic selectors
                        const articleData = await page.evaluate((index) => {
                            // Find the element
                            const elements = document.querySelectorAll('div.gc__content-container > div, .search-result, .search-results > div');
                            const element = elements[index];
                            
                            if (!element) return null;
                            
                            // Extract title and link
                            const titleElement = element.querySelector('a, h1, h2, h3, h4, [class*="title"], [class*="headline"]');
                            const title = titleElement ? titleElement.textContent.trim() : null;
                            const link = titleElement && titleElement.href ? titleElement.href : null;
                            
                            // Extract date
                            const dateElement = element.querySelector('time, [class*="date"], [class*="time"]');
                            const date = dateElement ? dateElement.textContent.trim() : null;
                            
                            // Extract summary
                            const summaryElement = element.querySelector('p, [class*="summary"], [class*="excerpt"], [class*="description"]');
                            const summary = summaryElement ? summaryElement.textContent.trim() : null;
                            
                            return {
                                title,
                                link,
                                date,
                                summary,
                                confidence: {
                                    title: title ? 0.7 : 0,
                                    link: link ? 0.7 : 0,
                                    date: date ? 0.6 : 0,
                                    summary: summary ? 0.6 : 0,
                                    overall: title && link ? 0.65 : 0.4
                                },
                                methods: {
                                    title: 'genericSelector',
                                    link: 'genericSelector',
                                    date: 'genericSelector',
                                    summary: 'genericSelector'
                                }
                            };
                        }, article.element);
                        
                        if (articleData && articleData.title && articleData.link) {
                            newsItems.push(articleData);
                            methodsUsed.add('genericSelector');
                        }
                    }
                }
                
                // Log the number of extracted items
                log.info(`Successfully extracted ${newsItems.length} news items`);
                
                // Save the results to the dataset
                await dataset.pushData(newsItems);
                extractedCount += newsItems.length;

                // Check if we've reached the maximum number of items
                if (maxItems > 0 && extractedCount >= maxItems) {
                    log.info(`Reached maximum number of items (${maxItems}), stopping the crawler.`);
                    await crawler.stop();
                }
            } catch (error) {
                log.error(`Error processing ${request.url}: ${error.message}`);
                throw error;
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
