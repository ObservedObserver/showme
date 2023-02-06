import { notify } from "../../../../components/error";
import { getRathError } from "../../../../rath-error";
import type { SupportedDatabaseType, TableColInfo, TableInfo, TableRowData } from "./type";


const apiPath = '/api/get_connection';

export type DatabaseApiOperator = (
    | 'ping'
    | 'getDatabases'
    | 'getSchemas'
    | 'getTables'
    | 'getTableDetail'
    | 'getResult'
);

export type DatabaseApiParams = {
    connectUri: string;
    sourceType: SupportedDatabaseType;
    operator: DatabaseApiOperator;
    databaseName: string;
    tableName: string;
    schemaName: string;
    tableHeadingCount: number;
    query: string;
};

export type DatabaseRequestPayload<P extends Exclude<DatabaseApiOperator, 'ping'>> = {
    uri: DatabaseApiParams['connectUri'];
    sourceType: DatabaseApiParams['sourceType'];
    func: P;
    db?: DatabaseApiParams['databaseName'] | null;
    schema: DatabaseApiParams['schemaName'] | null;
    table?: DatabaseApiParams['tableName'] | null;
    /** @default 500 */
    rowsNum?: DatabaseApiParams['tableHeadingCount'] | null;
    query?: DatabaseApiParams['query'] | null;
};

type Rq<T, Keys extends keyof T> = T & Required<Pick<T, Keys>>;

export type DatabaseRequestData = {
    ping: {
        func: 'ping';
    };
    getDatabases: DatabaseRequestPayload<'getDatabases'>;
    getSchemas: DatabaseRequestPayload<'getSchemas'>;
    getTables: DatabaseRequestPayload<'getTables'>;
    getTableDetail: Rq<DatabaseRequestPayload<'getTableDetail'>, 'table'>;
    getResult: Rq<DatabaseRequestPayload<'getResult'>, 'query'>;
};

export type DatabaseResponseData = {
    ping: undefined;
    getDatabases: string[];
    getSchemas: string[];
    getTables: TableInfo[];
    getTableDetail: {
        columns: TableColInfo[];
        rows: TableRowData[];
    };
    getResult: {
        rows: TableRowData[];
    };
};

type WrappedResponse<T> = {
    success: true;
    data: T;
} | {
    success: false;
    message: string;
};

const combinedDatabaseService = async <O extends DatabaseApiOperator>(
    server: string, operator: O, payload: Omit<DatabaseRequestData[O], 'func'>
): Promise<DatabaseResponseData[O]> => {
    const res = await fetch(
        `${server}${apiPath}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                ...payload,
                func: operator,
            }),
        }
    ).then(res => res.ok ? res.json() : (() => { throw new Error() })()) as WrappedResponse<DatabaseResponseData[O]>;

    return res.success ? res.data : (() => { throw new Error (res.message) })();
};

export const checkServerConnection = async (server: string): Promise<false | number> => {
    try {
        const beginTime = Date.now();
        await combinedDatabaseService(server, 'ping', {});
        const endTime = Date.now();
        return endTime - beginTime;
    } catch (error) {
        const rathError = getRathError('ConnectorError', error);
        console.warn(rathError);
        return false;
    }
};

export const fetchDatabaseList = async (server: string, payload: DatabaseRequestData['getDatabases']): Promise<string[]> => {
    try {
        return await combinedDatabaseService(server, 'getDatabases', payload);
    } catch (error) {
        const rathError = getRathError('FetchDatabaseListFailed', error);
        notify(rathError);
        return [];
    }
};

export const fetchSchemaList = async (server: string, payload: DatabaseRequestData['getSchemas']): Promise<string[]> => {
    try {
        return await combinedDatabaseService(server, 'getSchemas', payload);
    } catch (error) {
        const rathError = getRathError('FetchSchemaListFailed', error);
        notify(rathError);
        return [];
    }
};

export const fetchTableList = async (server: string, payload: DatabaseRequestData['getTables']): Promise<TableInfo[]> => {
    try {
        return await combinedDatabaseService(server, 'getTables', payload);
    } catch (error) {
        const rathError = getRathError('FetchTableListFailed', error);
        notify(rathError);
        return [];
    }
};

export const fetchTableDetail = async (server: string, payload: DatabaseRequestData['getTableDetail']): Promise<DatabaseResponseData['getTableDetail']> => {
    try {
        return await combinedDatabaseService(server, 'getTableDetail', payload);
    } catch (error) {
        const rathError = getRathError('FetchTableListFailed', error);
        notify(rathError);
        return {
            columns: [],
            rows: [],
        };
    }
};

export const fetchQueryResult = async (server: string, payload: DatabaseRequestData['getResult']): Promise<DatabaseResponseData['getResult']> => {
    try {
        return await combinedDatabaseService(server, 'getResult', payload);
    } catch (error) {
        const rathError = getRathError('QueryExecutionError', error);
        notify(rathError);
        return {
            rows: [],
        };
    }
};
