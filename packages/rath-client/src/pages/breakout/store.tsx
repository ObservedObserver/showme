import type { IFieldMeta, IFilter, IRow } from "@kanaries/loa";
import { makeAutoObservable, observable } from "mobx";
import { createContext, memo, useContext, useEffect, useMemo } from "react";
import { combineLatest, map, throttleTime, type Observable } from "rxjs";
import type { Aggregator } from "../../global";
import { toStream } from "../../utils/mobx-utils";
import { resolveCompareTarget } from "./components/controlPanel";
import { applyDividers, FieldStats, statDivision } from "./utils/stats";
import { analyzeComparisons, analyzeContributions, ISubgroupResult } from "./utils/top-drivers";


type Observed<T> = T extends Observable<infer U> ? U : never;

export type IUniqueFilter = IFilter & { id: string };
export type IExportFilter = IFilter & Pick<IFieldMeta, 'name' | 'semanticType'>;

export const NumericalMetricAggregationTypes = [
    'mean',
    'sum',
    'count',
    // MetricAggregationType.WeightedAverage,
    // MetricAggregationType.NumericalRate,
] as const;

export const CategoricalMetricAggregationTypes = [
    // MetricAggregationType.C_Rate,
    // MetricAggregationType.C_Count,
] as const;

export type BreakoutMainField = {
    fid: string;
    aggregator: Aggregator;
};

export type BreakoutMainFieldExport = BreakoutMainField & Pick<IFieldMeta, 'name' | 'semanticType'>;

export type BreakoutStoreExports = {
    mainField: BreakoutMainFieldExport | null;
    mainFieldFilters: IExportFilter[];
    comparisonFilters: IExportFilter[];
};

const exportFilters = (filters: IFilter[], fieldMetas: IFieldMeta[]): IExportFilter[] => {
    const result: IExportFilter[] = [];
    for (const filter of filters) {
        const field = fieldMetas.find(f => f.fid === filter.fid);
        if (field) {
            result.push({
                ...filter,
                name: field.name,
                semanticType: field.semanticType,
            });
        }
    }
    return result;
};

export class BreakoutStore {

    public readonly fields: IFieldMeta[];

    public mainField: Readonly<BreakoutMainField> | null;

    public mainFieldFilters: IFilter[];
    
    public comparisonFilters: IFilter[];

    public selection: readonly IRow[];
    public diffGroup: readonly IRow[];

    public globalStats: FieldStats | null;
    public selectionStats: FieldStats | null;
    public diffStats: FieldStats | null;

    public generalAnalyses: ISubgroupResult[];
    public comparisonAnalyses: ISubgroupResult[];
    
    constructor(data: IRow[], fields: IFieldMeta[]) {
        this.fields = fields;
        this.mainField = null;
        this.mainFieldFilters = [];
        this.comparisonFilters = [];
        this.selection = data;
        this.diffGroup = [];
        this.globalStats = null;
        this.selectionStats = null;
        this.diffStats = null;
        this.generalAnalyses = [];
        this.comparisonAnalyses = [];
        makeAutoObservable(this, {
            destroy: false,
            fields: false,
            mainField: observable.ref,
            mainFieldFilters: observable.ref,
            comparisonFilters: observable.ref,
            selection: observable.ref,
            diffGroup: observable.ref,
            globalStats: observable.ref,
            selectionStats: observable.ref,
            diffStats: observable.ref,
            generalAnalyses: observable.ref,
            comparisonAnalyses: observable.ref,
        });
        const mainField$ = toStream(() => this.mainField, true);
        const mainFieldFilters$ = toStream(() => this.mainFieldFilters, true);
        const comparisonFilters$ = toStream(() => this.comparisonFilters, true);

        const inputFlow$ = combineLatest({
            mainField: mainField$,
            mainFieldFilters: mainFieldFilters$,
            comparisonFilters: comparisonFilters$,
        });

        const global$ = inputFlow$.pipe(
            throttleTime(200, undefined, { leading: true, trailing: true }),
            map(input => {
                const { mainField } = input;
                const targetField = mainField ? resolveCompareTarget(mainField, fields) : null;
                let globalStats: typeof this['globalStats'] = null;
                if (mainField && targetField) {
                    globalStats = {
                        definition: mainField,
                        field: targetField.field,
                        stats: statDivision(data, data, fields, targetField.field.fid),
                    };
                }
                return {
                    ...input,
                    targetField,
                    globalStats,
                };
            })
        );

        const mainGroup$ = global$.pipe(
            map(({ mainField, mainFieldFilters, targetField, globalStats }) => {
                const [filtered] = applyDividers(data, mainFieldFilters);
                const selection = filtered;
                let stats: FieldStats | null = null;
                if (mainField && targetField && mainFieldFilters.length > 0) {
                    stats = {
                        definition: mainField,
                        field: targetField.field,
                        stats: statDivision(data, filtered, fields, mainField.fid),
                    };
                }
                return { data: selection, stats, mainField, globalStats };
            })
        );

        const generalAnalyses$ = mainGroup$.pipe(
            map<Observed<typeof mainGroup$>, ISubgroupResult[]>(({ data, globalStats, mainField }) => {
                if (!mainField || !globalStats) {
                    return [];
                }
                return analyzeContributions(
                    data,
                    fields,
                    mainField,
                    globalStats.stats[mainField.aggregator],
                );
            })
        );

        const compareGroup$ = global$.pipe(
            map<Observed<typeof global$>, { data: readonly IRow[]; stats: FieldStats | null }>(({ mainField, comparisonFilters, globalStats }) => {
                if (!mainField || !globalStats || comparisonFilters.length === 0) {
                    return {
                        data: [],
                        stats: null,
                    };
                }
                const [filtered] = applyDividers(data, comparisonFilters);
                const stats: FieldStats = {
                    definition: mainField,
                    field: resolveCompareTarget(mainField, fields)!.field,
                    stats: statDivision(data, filtered, fields, mainField.fid),
                };
                return { data: filtered, stats };
            })
        );

        const comparisonBase$ = combineLatest({
            mainGroup: mainGroup$,
            compareGroup: compareGroup$,
            global: global$,
        });

        const comparisonAnalyses$ = comparisonBase$.pipe(
            map<Observed<typeof comparisonBase$>, ISubgroupResult[]>(({ mainGroup, compareGroup, global }) => {
                const { data: population } = mainGroup;
                const { mainField, comparisonFilters } = global;
                if (!mainField || comparisonFilters.length === 0) {
                    return [];
                }
                return analyzeComparisons(
                    population,
                    compareGroup.data,
                    fields,
                    mainField,
                );
            })
        );

        const subscriptions = [
            // update global stats
            global$.subscribe(({ globalStats }) => {
                this.updateGlobalStats(globalStats);
            }),
            // update main group stats
            mainGroup$.subscribe(({ data, stats }) => {
                this.updateMainGroupStats(data, stats);
            }),
            // analyze contributions
            generalAnalyses$.subscribe(analysis => {
                this.updateGeneralAnalyses(analysis);
            }),
            // update comparison group stats
            compareGroup$.subscribe(({ data, stats }) => {
                this.updateComparisonGroupStats(data, stats);
            }),
            // update comparison group analyses
            comparisonAnalyses$.subscribe(analyses => {
                this.updateComparisonAnalyses(analyses);
            }),
        ];

        this.destroy = () => {
            for (const subscription of subscriptions) {
                subscription.unsubscribe();
            }
        };
    }

    public destroy: () => void = () => {};

    public export(): BreakoutStoreExports {
        const main = this.mainField ? resolveCompareTarget(this.mainField, this.fields) : null;
        return {
            mainField: main ? {
                ...this.mainField!,
                name: main.field.name,
                semanticType: main.field.semanticType,
            } : null,
            mainFieldFilters: exportFilters(this.mainFieldFilters, this.fields),
            comparisonFilters: exportFilters(this.comparisonFilters, this.fields),
        };
    }

    public setMainField(mainField: Readonly<BreakoutMainField> | null) {
        this.mainField = mainField;
    }

    public setMainFieldFilters(mainFieldFilters: IFilter[]) {
        this.mainFieldFilters = mainFieldFilters;
    }

    public setComparisonFilters(comparisonFilters: IFilter[]) {
        this.comparisonFilters = comparisonFilters;
    }

    protected updateGlobalStats(stats: FieldStats | null) {
        this.globalStats = stats;
    }

    protected updateMainGroupStats(data: readonly IRow[], stats: FieldStats | null) {
        this.selection = data;
        this.selectionStats = stats;
    }

    protected updateGeneralAnalyses(analysis: ISubgroupResult[]) {
        this.generalAnalyses = analysis;
    }

    protected updateComparisonGroupStats(data: readonly IRow[], stats: FieldStats | null) {
        this.diffGroup = data;
        this.diffStats = stats;
    }

    protected updateComparisonAnalyses(analysis: ISubgroupResult[]) {
        this.comparisonAnalyses = analysis;
    }

}

const BreakoutContext = createContext<BreakoutStore>(null!);

export const useBreakoutContext = (data: IRow[], fields: IFieldMeta[]) => {
    const store = useMemo(() => new BreakoutStore(data, fields), [data, fields]);
    const context = useContext(BreakoutContext);

    useEffect(() => {
        return () => {
            store.destroy();
        };
    }, [store]);

    return useMemo(() => ({
        BreakoutProvider: memo(function BreakoutProvider ({ children }) {
            return (
                <BreakoutContext.Provider value={store}>
                    {children}
                </BreakoutContext.Provider>
            );
        }),
        value: context,
    }), [store, context]);
};

export const useBreakoutStore = () => {
    const store = useContext(BreakoutContext);
    return store;
};
