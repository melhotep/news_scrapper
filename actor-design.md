# Apify News Scraper Actor Design

## Project Structure
```
apify-news-scraper/
├── main.js             # Main entry point for the actor
├── package.json        # Project dependencies and metadata
├── INPUT_SCHEMA.json   # Schema for actor input
└── README.md           # Documentation for the actor
```

## Dependencies
- `apify`: Core SDK for creating Apify actors
- `playwright`: For browser automation and handling dynamic content
- `crawlee`: For web scraping utilities

## Actor Input Schema
```json
{
  "title": "News Scraper Input",
  "type": "object",
  "schemaVersion": 1,
  "properties": {
    "url": {
      "title": "URL",
      "type": "string",
      "description": "URL of the news site to scrape",
      "editor": "textfield"
    },
    "maxItems": {
      "title": "Maximum Items",
      "type": "integer",
      "description": "Maximum number of news items to extract (0 for unlimited)",
      "default": 0,
      "minimum": 0,
      "editor": "number"
    }
  },
  "required": ["url"]
}
```

## Scraping Strategy
1. Launch Playwright browser
2. Navigate to the provided URL
3. Wait for dynamic content to load
4. Identify news item containers using CSS selectors
5. Extract required data (title, link, date, summary) from each container
6. Format and store data in JSON format
7. Close browser and return results

## CSS Selectors (for Al Jazeera example)
Based on the example URL (https://www.aljazeera.com/search/iraq%20oil?sort=date), the following selectors will be used:

- News item container: `.gc__content-container article`
- Title: `.gc__title-link`
- Link: `.gc__title-link` (href attribute)
- Date: `.gc__date`
- Summary: `.gc__excerpt`

These selectors may need adjustment during implementation and testing.

## Error Handling
- Implement timeout handling for page loading
- Add retry logic for failed requests
- Include error logging for debugging
- Handle cases where certain fields might be missing

## Output Format
```json
{
  "newsItems": [
    {
      "title": "Example News Title",
      "link": "https://example.com/news/article",
      "date": "2025-06-01",
      "summary": "This is an example summary of the news article..."
    },
    ...
  ]
}
```
