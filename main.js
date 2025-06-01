/**
 * Universal News Scraper Actor with Anti-Blocking Measures
 * 
 * This actor scrapes news items from various dynamic news sites,
 * automatically detecting and extracting title, link, date, and summary.
 * Includes proxy rotation and user-agent rotation to avoid blocking.
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

    // List of user agents to rotate
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (iPad; CPU OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 Edg/91.0.864.59'
    ];

    // Create a PlaywrightCrawler instance
    const crawler = new PlaywrightCrawler({
        // Use headless browser for production
        launchContext: {
            launchOptions: {
                headless: true,
            },
        },
        // Add proxy configuration to avoid blocking
        proxyConfiguration: await Actor.createProxyConfiguration({
            groups: ['RESIDENTIAL'], // Use residential proxies to appear as regular users
        }),
        // Maximum time for each page
        navigationTimeoutSecs: 120,
        // Handler for each page
        async requestHandler({ page, request, log }) {
            log.info(`Processing ${request.url}...`);

            // Set a random user agent
            const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
            await page.setExtraHTTPHeaders({
                'User-Agent': randomUserAgent,
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Cache-Control': 'max-age=0'
            });

            // Wait for the page to load
            await page.waitForLoadState('domcontentloaded');
            log.info('Page DOM content loaded');

            // Check if we're blocked or access is denied
            const pageContent = await page.content();
            if (pageContent.includes('ACCESS DENIED') || 
                pageContent.includes('CAPTCHA') || 
                pageContent.includes('blocked') || 
                pageContent.includes('banned') ||
                pageContent.includes('security check')) {
                log.error('Access denied or blocked by the website. Trying with a different proxy...');
                
                // Save the blocked page for debugging
                await Actor.setValue('blocked_page', pageContent);
                await Actor.setValue('blocked_screenshot', await page.screenshot(), { contentType: 'image/png' });
                
                // Throw an error to trigger retry with a different proxy
                throw new Error('Access denied or blocked by the website');
            }

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
            const articleElements = await page.evaluate((pageUrl) => {
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
                
                // Helper function to clean text (remove extra whitespace, newlines)
                const cleanText = (text) => {
                    if (!text) return '';
                    return text.replace(/\s+/g, ' ').trim();
                };
                
                // Helper function to check if a link is likely a news article
                const isNewsArticleLink = (href) => {
                    if (!href) return false;
                    
                    // Skip navigation, social, and utility links
                    const skipPatterns = [
                        '/about', '/contact', '/privacy', '/terms', '/login', '/register', 
                        '/subscribe', '/newsletter', '/rss', '/feed', '/search', 
                        'facebook.com', 'twitter.com', 'instagram.com', 'linkedin.com',
                        'youtube.com', 'pinterest.com', 'whatsapp', 'telegram',
                        '#', 'javascript:', 'mailto:', 'tel:'
                    ];
                    
                    for (const pattern of skipPatterns) {
                        if (href.includes(pattern)) return false;
                    }
                    
                    // Check if it's a root/home page
                    const urlObj = new URL(href);
                    if (urlObj.pathname === '/' || urlObj.pathname === '') return false;
                    
                    return true;
                };
                
                // Special handling for alarabiya.net
                let alarabiyaResults = [];
                if (pageUrl.includes('alarabiya.net')) {
                    // Target the specific search result cards
                    const searchResultCards = Array.from(document.querySelectorAll('.search-result-card, .search-result, .card, article'));
                    
                    alarabiyaResults = searchResultCards
                        .filter(card => {
                            // Make sure it has a title and is not a cookie banner or navigation
                            return card.textContent.trim().length > 100 && 
                                   !card.textContent.includes('cookies') &&
                                   !card.textContent.includes('Accept') &&
                                   card.querySelector('a') !== null;
                        })
                        .map(card => {
                            // Extract title
                            let title = '';
                            let titleElement = card.querySelector('h1, h2, h3, h4, h5, h6');
                            if (titleElement) {
                                title = cleanText(titleElement.textContent);
                            } else {
                                // Try to find a substantial link that might be a title
                                const links = Array.from(card.querySelectorAll('a'))
                                    .filter(a => a.textContent.trim().length > 20);
                                
                                if (links.length > 0) {
                                    title = cleanText(links[0].textContent);
                                    titleElement = links[0];
                                }
                            }
                            
                            // Extract link
                            let link = '';
                            if (titleElement && titleElement.tagName === 'A') {
                                link = titleElement.href;
                            } else if (titleElement && titleElement.querySelector('a')) {
                                link = titleElement.querySelector('a').href;
                            } else {
                                const links = Array.from(card.querySelectorAll('a'))
                                    .filter(a => isNewsArticleLink(a.href));
                                
                                if (links.length > 0) {
                                    link = links[0].href;
                                }
                            }
                            
                            // Extract date
                            let date = '';
                            // Look for date text
                            const dateElements = card.querySelectorAll('[class*="date"], [class*="time"], time, .meta');
                            if (dateElements.length > 0) {
                                date = cleanText(dateElements[0].textContent);
                            } else {
                                // Look for text that might be a date
                                const spans = Array.from(card.querySelectorAll('span'));
                                for (const span of spans) {
                                    const text = span.textContent.trim();
                                    if (text.includes('ago') || 
                                        text.includes('day') || 
                                        text.includes('hour') || 
                                        text.includes('min') ||
                                        /\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(text)) {
                                        date = cleanText(text);
                                        break;
                                    }
                                }
                            }
                            
                            // Extract category/section
                            let category = '';
                            const categoryElements = card.querySelectorAll('[class*="category"], [class*="section"]');
                            if (categoryElements.length > 0) {
                                category = cleanText(categoryElements[0].textContent);
                            }
                            
                            // For alarabiya, we don't extract summaries as they're not consistently available
                            // Just return an empty string for summary
                            
                            return {
                                element: card,
                                title,
                                link,
                                date,
                                category,
                                summary: '',
                                method: 'alarabiya'
                            };
                        });
                }
                
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
                        
                        // Check if it's likely a news article link
                        const isNewsLink = isNewsArticleLink(link.href);
                        
                        return hasSubstantialText && notInNavigation && notJustImage && isNewsLink;
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
                    .filter(link => isNewsArticleLink(link.href))
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
                
                // APPROACH 5: Special case for card-based search results
                const cardSearchResults = [];
                
                // Method 1: Look for card-like containers with titles
                const cardContainers = Array.from(document.querySelectorAll('.card, [class*="card"], [class*="article"], [class*="post"], [class*="item"], [class*="story"], [class*="entry"]'));
                for (const card of cardContainers) {
                    if (card.textContent.trim().length > 100 && 
                        card.querySelector('a') && 
                        !card.textContent.includes('cookies') &&
                        !card.textContent.includes('Accept')) {
                        cardSearchResults.push(card);
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
                    ...alarabiyaResults.map(r => r.element), // Add alarabiya elements first
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
                const results = [];
                
                // First, add the pre-processed alarabiya results
                results.push(...alarabiyaResults);
                
                // Then process the other elements
                for (const element of combinedElements) {
                    // Skip if this element is already in alarabiyaResults
                    if (alarabiyaResults.some(r => r.element === element)) {
                        continue;
                    }
                    
                    // Extract title
                    let title = null;
                    let titleElement = null;
                    
                    // Try to find title in headings
                    const headings = element.querySelectorAll('h1, h2, h3, h4, h5, h6');
                    if (headings.length > 0) {
                        titleElement = headings[0];
                        title = cleanText(titleElement.textContent);
                    }
                    
                    // If no heading, try links with title-like classes
                    if (!title) {
                        const titleLinks = element.querySelectorAll('a[class*="title"], a[class*="headline"], a[class*="heading"]');
                        if (titleLinks.length > 0) {
                            titleElement = titleLinks[0];
                            title = cleanText(titleLinks[0].textContent);
                        }
                    }
                    
                    // If still no title, try any link with substantial text
                    if (!title) {
                        const links = Array.from(element.querySelectorAll('a'))
                            .filter(a => a.textContent.trim().length > 20 && isNewsArticleLink(a.href));
                        
                        if (links.length > 0) {
                            titleElement = links[0];
                            title = cleanText(links[0].textContent);
                        }
                    }
                    
                    // If still no title, try any link
                    if (!title) {
                        const links = Array.from(element.querySelectorAll('a'))
                            .filter(a => isNewsArticleLink(a.href));
                        
                        if (links.length > 0) {
                            titleElement = links[0];
                            title = cleanText(links[0].textContent);
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
                        const links = Array.from(element.querySelectorAll('a'))
                            .filter(a => isNewsArticleLink(a.href));
                        
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
                        date = timeEl.getAttribute('datetime') || cleanText(timeEl.textContent);
                    }
                    
                    // Try elements with date-like classes
                    if (!date) {
                        const dateElements = element.querySelectorAll('[class*="date"], [class*="time"], [class*="published"], [class*="meta"]');
                        if (dateElements.length > 0) {
                            date = cleanText(dateElements[0].textContent);
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
                                date = cleanText(text);
                                break;
                            }
                            
                            // Check for date patterns like "25 October 2010" or "18 April 2022"
                            const dateMatch = text.match(/\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i);
                            if (dateMatch) {
                                date = cleanText(text);
                                break;
                            }
                            
                            // Check for time patterns like "11:19:08 PM"
                            if (/\d{1,2}:\d{2}:\d{2}\s+(?:AM|PM)/.test(text)) {
                                date = cleanText(text);
                                break;
                            }
                            
                            // Check for "X days ago" pattern
                            if (/\d+\s+days?\s+ago/.test(text)) {
                                date = cleanText(text);
                                break;
                            }
                            
                            // Check for month and year pattern (e.g., "13 May 2025")
                            if (/\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/i.test(text)) {
                                date = cleanText(text);
                                break;
                            }
                            
                            // Check for year only (e.g., "2025")
                            if (/^20\d{2}$/.test(text)) {
                                date = cleanText(text);
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
                                date = cleanText(text);
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
                                date = cleanText(dateMatch[0]);
                                break;
                            }
                            
                            // Match patterns like "13 May 2025"
                            const shortDateMatch = text.match(/\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/i);
                            if (shortDateMatch) {
                                date = cleanText(shortDateMatch[0]);
                                break;
                            }
                            
                            // Match patterns like "May 13, 2025"
                            const americanDateMatch = text.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i);
                            if (americanDateMatch) {
                                date = cleanText(americanDateMatch[0]);
                                break;
                            }
                        }
                    }
                    
                    // Extract summary
                    let summary = '';  // Default to empty string
                    
                    // Try elements with summary-like classes
                    const summaryElements = element.querySelectorAll('[class*="summary"], [class*="excerpt"], [class*="description"], [class*="teaser"], [class*="intro"]');
                    if (summaryElements.length > 0) {
                        summary = cleanText(summaryElements[0].textContent);
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
                                    summary = cleanText(p.textContent);
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
                                summary = cleanText(spanText);
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
                                summary = cleanText(divText);
                                break;
                            }
                        }
                    }
                    
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
                    
                    // Add to results if we have at least a title and link
                    if (title && link) {
                        results.push({
                            title,
                            link,
                            date,
                            summary,
                            confidence: {
                                title: 0.9,
                                link: 0.9,
                                date: date ? 0.8 : 0,
                                summary: summary ? 0.8 : 0,
                                overall: (0.9 + 0.9 + (date ? 0.8 : 0) * 0.5 + (summary ? 0.8 : 0) * 0.5) / 3
                            },
                            methods: {
                                title: method,
                                link: method,
                                date: method,
                                summary: method
                            }
                        });
                    }
                }
                
                // Ensure results are unique by title
                const uniqueResults = [];
                const seenTitles = new Set();
                
                for (const result of results) {
                    if (result.title && !seenTitles.has(result.title)) {
                        uniqueResults.push(result);
                        seenTitles.add(result.title);
                    }
                }
                
                // Filter out results with low confidence and non-article links
                return uniqueResults
                    .filter(result => result.title && result.link)
                    .filter(result => {
                        // Skip cookie banners, privacy policies, etc.
                        const skipTitles = [
                            'cookie', 'privacy', 'terms', 'subscribe', 'newsletter',
                            'sign in', 'login', 'register', 'account', 'follow'
                        ];
                        
                        for (const skip of skipTitles) {
                            if (result.title.toLowerCase().includes(skip)) {
                                return false;
                            }
                        }
                        
                        return result.confidence.overall > 0.5;
                    })
                    .sort((a, b) => b.confidence.overall - a.confidence.overall);
            }, request.url);

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
        // Add retry configuration
        maxRequestRetries: 5,
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
