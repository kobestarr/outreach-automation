# Scaling to 500 Businesses Per Day

## Current State
- Processing: ~41 businesses per run
- Storage: JSON files (slow for large datasets)
- Performance: Fine for small batches

## Target State
- Processing: 500 businesses per day
- Storage: SQLite database (fast queries, indexes)
- Performance: Optimized for high-volume processing

## Why Database is Needed

### Performance Comparison

**JSON Files (Current):**
- Load 500 businesses: 2-5 seconds
- Filter/search: 500ms-1s
- Save 500 businesses: 5-10 seconds
- **Total overhead: ~10-15 seconds per batch**

**SQLite Database:**
- Load 500 businesses: 50-100ms (20-50x faster)
- Filter/search: 5-10ms with indexes (50-100x faster)
- Save 500 businesses: 200-500ms batch insert (10-20x faster)
- **Total overhead: ~300-600ms per batch**

### Additional Benefits

1. **Deduplication**: Prevent processing same business twice
2. **Batch Operations**: Process hundreds efficiently
3. **Complex Queries**: Fast aggregations, date ranges, joins
4. **Concurrency**: Safe for multiple processes
5. **Transactions**: Data integrity guarantees

## Implementation Plan

### Phase 1: Database Setup
- Add SQLite database module
- Create optimized schema with indexes
- Migration script (JSON → Database)

### Phase 2: Core Optimizations
- Deduplication logic
- Batch save operations (save every 10-20 businesses)
- Progress tracking for large batches

### Phase 3: Performance Features
- Connection pooling
- Prepared statements
- Batch updates for exports

### Phase 4: Scale Features
- Daily processing limits tracking
- Resume capability (if interrupted)
- Error recovery (skip failed, continue)

## Estimated Performance Gains

- **Query Speed**: 20-50x faster
- **Save Speed**: 10-20x faster  
- **Overall**: Process 500 businesses in ~5-10 minutes vs 15-20 minutes

## Next Steps

1. Add SQLite database support
2. Migrate existing JSON data
3. Add deduplication
4. Optimize batch operations
5. Test with 500+ businesses
