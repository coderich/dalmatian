# CHANGELOG

## v0.7.x
- Complete overhaul of Query to Mongo Driver (pagination, sorting, counts, etc)
- Removed countModel Queries from the API (now available as `count` property on `Connetion` types)
- Dropped Neo4J (temporarily)

## v0.6.x
- Mongo driver no longer checks for `version` directive
- Models no longer share a Connection type; removing the need to use `... on Model` for GraphQL queries
- Added `@field(connection: Boolean)` parameter to specifically indicate fields that should return a Connection type