export interface Queryable {
    query<ResultType extends {[key: string]: any}>(
        query: string,
        placeholders: any[]
    ): Promise<{
        rows: ResultType[],
        rowCount: number
    }>;
}
