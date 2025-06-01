/**
 * Universal News Scraper Actor
 * 
 * This actor scrapes news items from various dynamic news sites,
 * automatically detecting and extracting title, link, date, and summary.
 * Designed to work across a wide variety of news site structures.
 */

const { Actor } = require('apify');
const { PlaywrightCrawler, Dataset } = require('crawlee');

// Initialize the Actor
Actor.main(async () => {
    // Get input from the user
    const input = await Actor.getInput();
    console.log('Input:', input);

    if (!input || !input.url) {
        throw new Error('Input must contain a "url" field!');
    }

    const { url, maxItems = 0, waitTime = 30 } = input;
    console.log(`Starting universal news scraper for URL: ${url}`);
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
        // Maximum time for each page
        navigationTimeoutSecs: 120,
        // Handler for each page
        async requestHandler({ page, request, log }) {
            log.info(`Processing ${request.url}...`);

            // Wait for the page to load
            await page.waitForLoadState('domcontentloaded');
            log.info('Page DOM content loaded');

            // Wait additional time for dynamic content to load
            log.info(`Waiting ${waitTime} seconds for dynamic content...`);
            await page.waitForTimeout(waitTime * 1000);
            log.info('Wait completed');

            // Save a screenshot for debugging
            await Actor.setValue('screenshot', await page.screenshot(), { contentType: 'image/png' });
            log.info('Screenshot saved');

            // Save HTML content for debugging
            await Actor.setValue('html', await page.content());
            log.info('HTML content saved');

            // Extract articles using multiple approaches directly in browser context
            const articleElements = await page.evaluate(() => {
                // Helper function to check if an element is likely a search result
                const isLikelySearchResult = (element) => {
                    // Check if it has a heading and link
                    const hasHeading = element.querySelector('h1, h2, h3, h4, h5, h6') !== null;
                    const hasLink = element.querySelector('a') !== null;
                    
                    // Check if it has substantial content
                    const hasContent = element.textContent.trim().length > 80;
                    
                    // Check if it's not in a sidebar
                    const notInSidebar = 
                        !element.closest('[class*="sidebar"], [id*="sidebar"], [class*="widget"], [class*="latest"], [class*="most-read"]') &&
                        !element.closest('[class*="footer"], [id*="footer"], [class*="header"], [id*="header"]') &&
                        !element.closest('nav, [role="navigation"]');
                    
                    return hasHeading && hasLink && hasContent && notInSidebar;
                };
                
                // APPROACH 1: Find all potential article elements in the main content area
                const allArticleLikeElements = Array.from(document.querySelectorAll('article, div > h2, div > h3, .search-result, .result-item, .news-item, [class*="article"], [class*="post"], [class*="story"], [class*="entry"], [class*="item"], [class*="result"]'))
                    .filter(el => {
                        // For heading elements, get their parent
                        if (el.tagName === 'H1' || el.tagName === 'H2' || el.tagName === 'H3' || el.tagName === 'H4' || el.tagName === 'H5' || el.tagName === 'H6') {
                            return isLikelySearchResult(el.parentElement);
                        }
                        return isLikelySearchResult(el);
                    })
                    .map(el => {
                        // For heading elements, use their parent
                        if (el.tagName === 'H1' || el.tagName === 'H2' || el.tagName === 'H3' || el.tagName === 'H4' || el.tagName === 'H5' || el.tagName === 'H6') {
                            return el.parentElement;
                        }
                        return el;
                    });
                
                // APPROACH 2: Find all links with substantial text that might be article titles
                const substantialLinks = Array.from(document.querySelectorAll('a'))
                    .filter(link => {
                        // Check if the link has substantial text (likely a title)
                        const hasSubstantialText = link.textContent.trim().length > 30;
                        
                        // Check if it's not in navigation, header, or footer
                        const notInNavigation = 
                            !link.closest('nav, [role="navigation"], header, footer, [class*="menu"], [class*="nav"]');
                        
                        // Check if it's not just an image link
                        const notJustImage = link.textContent.trim().length > 0;
                        
                        return hasSubstantialText && notInNavigation && notJustImage;
                    })
                    .map(link => {
                        // Get the parent container that might contain date and summary
                        let container = link;
                        let depth = 0;
                        
                        // Go up the DOM tree to find a container with more content
                        while (depth < 5 && container.parentElement) {
                            container = container.parentElement;
                            
                            // If we found a container with substantial content, use it
                            if (container.textContent.trim().length > 150 || 
                                container.querySelectorAll('p, span, div').length > 2) {
                                break;
                            }
                            depth++;
                        }
                        
                        return container;
                    });
                
                // APPROACH 3: Special case for flat search results (like africanreview.com)
                // Look for h3 elements with links that are likely search results
                const flatSearchResults = Array.from(document.querySelectorAll('h1 > a, h2 > a, h3 > a, h4 > a, h5 > a, h6 > a, h1 a, h2 a, h3 a, h4 a, h5 a, h6 a'))
                    .map(link => {
                        // Get the heading element
                        const heading = link.closest('h1, h2, h3, h4, h5, h6');
                        
                        // Get the parent container that might contain date and summary
                        let container = heading.parentElement;
                        let depth = 0;
                        
                        // Go up the DOM tree to find a container with more content
                        while (depth < 3 && container && container.parentElement) {
                            // If we found a container with substantial content, use it
                            if (container.textContent.trim().length > 150 || 
                                container.querySelectorAll('p, span, div').length > 2) {
                                break;
                            }
                            container = container.parentElement;
                            depth++;
                        }
                        
                        return container;
                    })
                    .filter(el => el && el.textContent.trim().length > 100);
                
                // APPROACH 4: Special case for table-based search results (like ahram.org.eg)
                const tableSearchResults = Array.from(document.querySelectorAll('table tr, tbody tr'))
                    .filter(tr => {
                        // Check if the row has a title and content
                        return (tr.querySelector('h1 a, h2 a, h3 a, h4 a, h5 a, h6 a, h1 > a, h2 > a, h3 > a, h4 > a, h5 > a, h6 > a') !== null || 
                               tr.querySelector('a') !== null) && 
                               tr.textContent.trim().length > 100;
                    });
                
                // APPROACH 5: Special case for card-based search results (like alarabiya.net)
                const cardSearchResults = [];
                
                // Method 1: Look for card-like containers with titles
                const cardContainers = Array.from(document.querySelectorAll('.card, [class*="card"], [class*="article"], [class*="post"], [class*="item"], [class*="story"], [class*="entry"]'));
                for (const card of cardContainers) {
                    if (card.textContent.trim().length > 100 && card.querySelector('a')) {
                        cardSearchResults.push(card);
                    }
                }
                
                // Method 2: For alarabiya.net specifically, look for their search result structure
                const alarabiyaResults = Array.from(document.querySelectorAll('a[href*="/News/"], a[href*="/Views/"], a[href*="/news/"], a[href*="/article/"]'))
                    .filter(link => {
                        // Make sure it's a search result link (has title text and not just an image)
                        return link.textContent.trim().length > 20 && 
                               !link.closest('header') && 
                               !link.closest('nav') &&
                               !link.closest('footer');
                    })
                    .map(link => {
                        // Get the parent container that holds the entire result card
                        let container = link;
                        let depth = 0;
                        // Go up the DOM tree to find a container with date info
                        while (depth < 5 && container.parentElement) {
                            container = container.parentElement;
                            // If we found a container with date or category info, use it
                            if (container.textContent.includes('ago') || 
                                container.textContent.match(/\d{4}/) || // Contains a year
                                container.textContent.includes('News') || 
                                container.textContent.includes('Views')) {
                                break;
                            }
                            depth++;
                        }
                        return container;
                    });
                
                // Add alarabiya results to card results if they're not already included
                for (const result of alarabiyaResults) {
                    if (!cardSearchResults.includes(result)) {
                        cardSearchResults.push(result);
                    }
                }
                
                // APPROACH 6: Special case for AP News style results
                const apNewsResults = Array.from(document.querySelectorAll('[data-key], [data-id]'))
                    .filter(el => {
                        return el.textContent.trim().length > 100 && 
                               el.querySelector('a') !== null;
                    });
                
                // APPROACH 7: Special case for Argus Media style results
                const argusResults = Array.from(document.querySelectorAll('.search-result, .result, [class*="search-result"], [class*="search_result"]'))
                    .filter(el => {
                        return el.textContent.trim().length > 100 && 
                               el.querySelector('a') !== null;
                    });
                
                // APPROACH 8: Special case for Al-Monitor style results
                const alMonitorResults = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
                    .filter(heading => {
                        return heading.querySelector('a') !== null && 
                               heading.textContent.trim().length > 20;
                    })
                    .map(heading => {
                        // Get the parent container
                        let container = heading.parentElement;
                        let depth = 0;
                        
                        // Go up the DOM tree to find a container with more content
                        while (depth < 3 && container && container.parentElement) {
                            // If we found a container with substantial content, use it
                            if (container.textContent.trim().length > 150 || 
                                container.querySelectorAll('p, span, div').length > 1) {
                                break;
                            }
                            container = container.parentElement;
                            depth++;
                        }
                        
                        return container;
                    });
                
                // Combine all potential article elements
                const combinedElements = [
                    ...allArticleLikeElements, 
                    ...substantialLinks,
                    ...flatSearchResults,
                    ...tableSearchResults,
                    ...cardSearchResults,
                    ...apNewsResults,
                    ...argusResults,
                    ...alMonitorResults
                ];
                
                // Extract data from each potential article
                const results = combinedElements.map(element => {
                    // Extract title
                    let title = null;
                    let titleElement = null;
                    
                    // Try to find title in headings
                    const headings = element.querySelectorAll('h1, h2, h3, h4, h5, h6');
                    if (headings.length > 0) {
                        titleElement = headings[0];
                        title = titleElement.textContent.trim();
                    }
                    
                    // If no heading, try links with title-like classes
                    if (!title) {
                        const titleLinks = element.querySelectorAll('a[class*="title"], a[class*="headline"], a[class*="heading"]');
                        if (titleLinks.length > 0) {
                            titleElement = titleLinks[0];
                            title = titleElement.textContent.trim();
                        }
                    }
                    
                    // If still no title, try any link with substantial text
                    if (!title) {
                        const links = Array.from(element.querySelectorAll('a'))
                            .filter(a => a.textContent.trim().length > 20);
                        
                        if (links.length > 0) {
                            titleElement = links[0];
                            title = titleElement.textContent.trim();
                        }
                    }
                    
                    // If still no title, try any link
                    if (!title) {
                        const links = element.querySelectorAll('a');
                        if (links.length > 0) {
                            titleElement = links[0];
                            title = titleElement.textContent.trim();
                        }
                    }
                    
                    // Extract link
                    let link = null;
                    
                    // If title element is or contains an anchor, use its href
                    if (titleElement) {
                        if (titleElement.tagName === 'A') {
                            link = titleElement.href;
                        } else {
                            const anchorInTitle = titleElement.querySelector('a');
                            if (anchorInTitle) {
                                link = anchorInTitle.href;
                            }
                        }
                    }
                    
                    // If no link found yet, try other links
                    if (!link) {
                        const links = element.querySelectorAll('a');
                        if (links.length > 0) {
                            link = links[0].href;
                        }
                    }
                    
                    // Extract date
                    let date = null;
                    
                    // Try time elements
                    const timeElements = element.querySelectorAll('time, [datetime]');
                    if (timeElements.length > 0) {
                        const timeEl = timeElements[0];
                        date = timeEl.getAttribute('datetime') || timeEl.textContent.trim();
                    }
                    
                    // Try elements with date-like classes
                    if (!date) {
                        const dateElements = element.querySelectorAll('[class*="date"], [class*="time"], [class*="published"], [class*="meta"]');
                        if (dateElements.length > 0) {
                            date = dateElements[0].textContent.trim();
                        }
                    }
                    
                    // Try to find date in span elements
                    if (!date) {
                        const spans = element.querySelectorAll('span');
                        for (const span of spans) {
                            const text = span.textContent.trim();
                            // Check for date patterns like MM/DD/YYYY or DD/MM/YYYY
                            if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(text) || 
                                /\d{1,2}-\d{1,2}-\d{4}/.test(text) ||
                                /\d{1,2}\.\d{1,2}\.\d{4}/.test(text)) {
                                date = text;
                                break;
                            }
                            
                            // Check for date patterns like "25 October 2010" or "18 April 2022"
                            const dateMatch = text.match(/\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i);
                            if (dateMatch) {
                                date = text;
                                break;
                            }
                            
                            // Check for time patterns like "11:19:08 PM"
                            if (/\d{1,2}:\d{2}:\d{2}\s+(?:AM|PM)/.test(text)) {
                                date = text;
                                break;
                            }
                            
                            // Check for "X days ago" pattern
                            if (/\d+\s+days?\s+ago/.test(text)) {
                                date = text;
                                break;
                            }
                            
                            // Check for month and year pattern (e.g., "13 May 2025")
                            if (/\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/i.test(text)) {
                                date = text;
                                break;
                            }
                            
                            // Check for year only (e.g., "2025")
                            if (/^20\d{2}$/.test(text)) {
                                date = text;
                                break;
                            }
                        }
                    }
                    
                    // Try to find date in div elements
                    if (!date) {
                        const divs = element.querySelectorAll('div');
                        for (const div of divs) {
                            const text = div.textContent.trim();
                            // Skip if too long to be a date
                            if (text.length > 30) continue;
                            
                            // Check for date patterns
                            if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(text) || 
                                /\d{1,2}-\d{1,2}-\d{4}/.test(text) ||
                                /\d{1,2}\.\d{1,2}\.\d{4}/.test(text) ||
                                /\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i.test(text) ||
                                /\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/i.test(text) ||
                                /\d+\s+days?\s+ago/.test(text)) {
                                date = text;
                                break;
                            }
                        }
                    }
                    
                    // Try to find date in text content (common pattern: DD Month YYYY)
                    if (!date) {
                        // Get all text nodes directly under the element
                        const textNodes = Array.from(element.childNodes)
                            .filter(node => node.nodeType === Node.TEXT_NODE)
                            .map(node => node.textContent.trim())
                            .filter(text => text.length > 0);
                        
                        // Look for date patterns in text nodes
                        for (const text of textNodes) {
                            // Match patterns like "25 October 2010" or "18 April 2022"
                            const dateMatch = text.match(/\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i);
                            if (dateMatch) {
                                date = dateMatch[0];
                                break;
                            }
                            
                            // Match patterns like "13 May 2025"
                            const shortDateMatch = text.match(/\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/i);
                            if (shortDateMatch) {
                                date = shortDateMatch[0];
                                break;
                            }
                            
                            // Match patterns like "May 13, 2025"
                            const americanDateMatch = text.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i);
                            if (americanDateMatch) {
                                date = americanDateMatch[0];
                                break;
                            }
                        }
                    }
                    
                    // Extract summary
                    let summary = null;
                    
                    // Try elements with summary-like classes
                    const summaryElements = element.querySelectorAll('[class*="summary"], [class*="excerpt"], [class*="description"], [class*="teaser"], [class*="intro"]');
                    if (summaryElements.length > 0) {
                        summary = summaryElements[0].textContent.trim();
                    }
                    
                    // Try paragraphs
                    if (!summary) {
                        const paragraphs = element.querySelectorAll('p');
                        if (paragraphs.length > 0) {
                            // Skip paragraphs that contain the title
                            for (const p of paragraphs) {
                                if (title && p.textContent.includes(title)) {
                                    continue;
                                }
                                if (p.textContent.trim().length > 20) {
                                    summary = p.textContent.trim();
                                    break;
                                }
                            }
                        }
                    }
                    
                    // Try spans (common in table-based layouts)
                    if (!summary) {
                        const spans = element.querySelectorAll('span');
                        // Skip the first span if it contains the date
                        for (let i = 0; i < spans.length; i++) {
                            const spanText = spans[i].textContent.trim();
                            // Skip if this span contains the date
                            if (date && spanText.includes(date)) {
                                continue;
                            }
                            // Skip if this span contains the title
                            if (title && spanText.includes(title)) {
                                continue;
                            }
                            // Use this span if it has substantial text
                            if (spanText.length > 30) {
                                summary = spanText;
                                break;
                            }
                        }
                    }
                    
                    // Try divs for summary
                    if (!summary) {
                        const divs = element.querySelectorAll('div');
                        for (const div of divs) {
                            const divText = div.textContent.trim();
                            // Skip if this div contains the date or title
                            if ((date && divText.includes(date)) || 
                                (title && divText.includes(title))) {
                                continue;
                            }
                            // Use this div if it has substantial text
                            if (divText.length > 40 && divText.length < 500) {
                                summary = divText;
                                break;
                            }
                        }
                    }
                    
                    // For news sites, try to extract category and date as summary
                    if (!summary) {
                        const categoryElements = element.querySelectorAll('[class*="category"], [class*="section"]');
                        const dateElements = element.querySelectorAll('[class*="date"], [class*="time"]');
                        
                        let categoryText = '';
                        let dateText = '';
                        
                        if (categoryElements.length > 0) {
                            categoryText = categoryElements[0].textContent.trim();
                        }
                        
                        if (dateElements.length > 0) {
                            dateText = dateElements[0].textContent.trim();
                        }
                        
                        if (categoryText || dateText) {
                            summary = [categoryText, dateText].filter(Boolean).join(' - ');
                        }
                    }
                    
                    // If still no summary, try to extract text after the title/date
                    if (!summary && titleElement) {
                        // Get all text content
                        const fullText = element.textContent;
                        
                        // Remove the title text
                        let remainingText = fullText.replace(title, '');
                        
                        // Remove the date if found
                        if (date) {
                            remainingText = remainingText.replace(date, '');
                        }
                        
                        // Clean up and use as summary
                        summary = remainingText.trim()
                            .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
                            .substring(0, 300);    // Limit length
                        
                        if (summary.length < 20) {
                            summary = null;  // Too short to be meaningful
                        }
                    }
                    
                    // Calculate confidence scores
                    const titleConfidence = title ? 0.9 : 0;
                    const linkConfidence = link ? 0.9 : 0;
                    const dateConfidence = date ? 0.8 : 0;
                    const summaryConfidence = summary ? 0.8 : 0;
                    const overallConfidence = (titleConfidence + linkConfidence + dateConfidence * 0.5 + summaryConfidence * 0.5) / 3;
                    
                    // Determine which method was used
                    let method = 'direct';
                    if (element.tagName === 'TR' || element.closest('tr')) {
                        method = 'table';
                    } else if (element.querySelector('h3 > a, h3 a')) {
                        method = 'flat';
                    } else if (element.classList && 
                              (element.classList.contains('card') || 
                               Array.from(element.classList).some(c => c.includes('card')) ||
                               Array.from(element.classList).some(c => c.includes('article')) ||
                               Array.from(element.classList).some(c => c.includes('post')) ||
                               Array.from(element.classList).some(c => c.includes('item')))) {
                        method = 'card';
                    } else if (element.hasAttribute('data-key') || element.hasAttribute('data-id')) {
                        method = 'data-attribute';
                    } else if (element.classList && 
                              (element.classList.contains('search-result') || 
                               Array.from(element.classList).some(c => c.includes('search')))) {
                        method = 'search-result';
                    }
                    
                    return {
                        title,
                        link,
                        date,
                        summary,
                        confidence: {
                            title: titleConfidence,
                            link: linkConfidence,
                            date: dateConfidence,
                            summary: summaryConfidence,
                            overall: overallConfidence
                        },
                        methods: {
                            title: method,
                            link: method,
                            date: method,
                            summary: method
                        }
                    };
                });
                
                // Ensure results are unique by title
                const uniqueResults = [];
                const seenTitles = new Set();
                
                for (const result of results) {
                    if (result.title && !seenTitles.has(result.title)) {
                        uniqueResults.push(result);
                        seenTitles.add(result.title);
                    }
                }
                
                // Filter out results with low confidence
                return uniqueResults
                    .filter(result => result.title && result.link)
                    .filter(result => result.confidence.overall > 0.5)
                    .sort((a, b) => b.confidence.overall - a.confidence.overall);
            });

            log.info(`Found ${articleElements.length} article elements`);

            // Process and store the extracted articles
            for (const article of articleElements) {
                // Skip if we've reached the maximum number of items
                if (maxItems > 0 && extractedCount >= maxItems) {
                    log.info(`Reached maximum number of items (${maxItems}), stopping extraction`);
                    break;
                }

                // Add extraction method to the set
                methodsUsed.add(article.methods.title);

                // Push the article to the dataset
                await dataset.pushData(article);
                extractedCount++;
            }

            log.info(`Extracted ${extractedCount} articles in total`);
        },
        // Handle errors
        failedRequestHandler({ request, error, log }) {
            log.error(`Request ${request.url} failed with error: ${error.message}`);
        },
    });

    // Add the URL to the queue
    await crawler.run([url]);

    // Get all the data from the dataset
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
