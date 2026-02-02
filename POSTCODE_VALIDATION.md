# Postcode Validation Feature

## Problem
Multiple locations share the same name (e.g., multiple "Bramhall" locations, multiple "Cheadle" locations). We need to ensure we're targeting the correct area.

## Solution
Added postcode validation at two levels:

### 1. Location Formatting
- Location is formatted as "Location, Postcode" for HasData API
- Example: "Bramhall, SK7" instead of just "Bramhall"
- This helps HasData target the correct area

### 2. Result Filtering
- After scraping, results are filtered by postcode prefix
- Only businesses matching the postcode area are included
- Example: If searching "Bramhall SK7", businesses with "B1" (Birmingham) are excluded

## Implementation

### Google Maps Scraper
- Accepts  parameter
- Formats location as "Location, Postcode"
- Filters results by postcode prefix
- Extracts postcode from address strings

### Main Orchestrator
- Accepts postcode as second parameter: 
- Defaults to "SK7" for Bramhall if not specified
- Passes postcode through to scraper and Companies House lookup

## Usage



## Postcode Format
- Accepts full postcode: "SK7 1AA"
- Accepts prefix only: "SK7"
- Case insensitive
- Filters by prefix (first part before space)

## Example
Searching "Bramhall SK7" will:
1. Query HasData with "CUSTOM>Bramhall, SK7"
2. Filter results to only include businesses with SK7 postcodes
3. Exclude businesses from other Bramhall locations (e.g., Birmingham)
