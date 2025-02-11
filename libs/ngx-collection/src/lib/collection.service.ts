import { catchError, EMPTY, finalize, first, forkJoin, isObservable, map, Observable, startWith, Subject, switchMap } from 'rxjs';
import { Inject, Injectable, Optional } from '@angular/core';
import { ComponentStore, tapResponse } from '@ngrx/component-store';
import { concatLatestFrom } from '@ngrx/effects';
import { FetchedItems } from './interfaces';
import { Comparator, ObjectsComparator, ObjectsComparatorFn } from './comparator';
import { isEmptyValue } from './helpers';

export interface CollectionState<T, UniqueStatus = any, Status = any> {
  readonly items: T[];
  readonly totalCountFetched?: number;
  readonly isCreating: boolean;
  readonly isReading: boolean;
  readonly updatingItems: T[];
  readonly deletingItems: T[];
  readonly refreshingItems: T[];
  readonly status: Map<UniqueStatus, T>;
  readonly statuses: Map<T, Set<Status>>;
}

export interface CreateParams<T> {
  readonly request: Observable<T>;
  readonly onSuccess?: (item: T) => void;
  readonly onError?: (error: unknown) => void;
}

export interface CreateManyParams<T> {
  readonly request: Observable<FetchedItems<T> | T[]> | Observable<T>[];
  readonly onSuccess?: (items: T[]) => void;
  readonly onError?: (error: unknown) => void;
}

export interface ReadParams<T> {
  readonly request: Observable<FetchedItems<T> | T[]>;
  readonly onSuccess?: (items: T[]) => void;
  readonly onError?: (error: unknown) => void;
  readonly keepExistingOnError?: boolean;
}

export interface ReadOneParams<T> {
  readonly request: Observable<T>;
  readonly onSuccess?: (item: T) => void;
  readonly onError?: (error: unknown) => void;
}

export interface ReadManyParams<T> {
  readonly request: Observable<FetchedItems<T> | T[]> | Observable<T>[];
  readonly onSuccess?: (items: T[]) => void;
  readonly onError?: (error: unknown) => void;
}

export interface UpdateParams<T> {
  readonly request: Observable<T>;
  readonly refreshRequest?: Observable<T>;
  readonly item: Partial<T>;
  readonly onSuccess?: (item: T) => void;
  readonly onError?: (error: unknown) => void;
}

export interface UpdateManyParams<T> {
  readonly request: Observable<T[]> | Observable<T>[];
  readonly refreshRequest?: Observable<FetchedItems<T> | T[]>;
  readonly items: Partial<T>[];
  readonly onSuccess?: (item: T[]) => void;
  readonly onError?: (error: unknown) => void;
}

export interface DeleteParams<T, R = unknown> {
  readonly request: Observable<R>;
  readonly item: Partial<T>;
  /**
   * If `decrementTotalCount` is provided (and `readRequest` is not provided):
   * boolean: decrement `totalCountFetched` by 1 (if current totalCountFetched > 0);
   * number: decrement `totalCountFetched` by number (should be integer, less or equal to the current value of `totalCountFetched`);
   * string: points what field of the response object should be used (if exist) as a source of `totalCountFetched` (should be integer, >= 0).
   */
  readonly decrementTotalCount?: boolean | number | string;
  /**
   * Consecutive read() request.
   * If provided, it will be the source of the new set of items (decrementTotalCount will be ignored).
   */
  readonly readRequest?: Observable<FetchedItems<T> | T[]>;
  readonly onSuccess?: (response: R) => void;
  readonly onError?: (error: unknown) => void;
}

export interface DeleteManyParams<T, R = unknown> {
  readonly request: Observable<R> | Observable<R>[];
  readonly items: Partial<T>[];
  /**
   * If `decrementTotalCount` is provided (and `readRequest` is not provided):
   * boolean: decrement `totalCountFetched` by number of removed items (if resulting `totalCountFetched` >= 0);
   * number: decrement `totalCountFetched` by number (should be integer, less or equal to the current value of `totalCountFetched`);
   * string: points what field of the response object (first one, if it's an array) should be used (if exist) as a source of `totalCountFetched` (should be integer, >= 0).
   */
  readonly decrementTotalCount?: boolean | number | string;
  /**
   * Consecutive read() request.
   * If provided, it will be the source of the new set of items (decrementTotalCount will be ignored).
   */
  readonly readRequest?: Observable<FetchedItems<T> | T[]>;
  readonly onSuccess?: (response: R[]) => void;
  readonly onError?: (error: unknown) => void;
}

export interface RefreshParams<T> {
  readonly request: Observable<T>;
  readonly item: Partial<T>;
  readonly onSuccess?: (item: T) => void;
  readonly onError?: (error: unknown) => void;
}

export interface RefreshManyParams<T> {
  readonly request: Observable<FetchedItems<T> | T[]> | Observable<T>[];
  readonly items: Partial<T>[];
  readonly onSuccess?: (item: T[]) => void;
  readonly onError?: (error: unknown) => void;
}

export type DuplicatesMap<T> = Record<number, Record<number, T>>;

export interface CollectionServiceOptions {
  comparatorFields?: (string | string[])[];
  comparator?: ObjectsComparator | ObjectsComparatorFn;
  throwOnDuplicates?: string;
  allowFetchedDuplicates?: boolean;
  onDuplicateErrCallbackParam?: any;
  errReporter?: (...args: any[]) => any;
}

@Injectable()
export class CollectionService<T, UniqueStatus = any, Status = any> extends ComponentStore<CollectionState<T, UniqueStatus, Status>> {
  public readonly items$ = this.select(s => s.items);
  public readonly totalCountFetched$ = this.select(s => s.totalCountFetched);
  public readonly updatingItems$ = this.select(s => s.updatingItems);
  public readonly deletingItems$ = this.select(s => s.deletingItems);
  public readonly refreshingItems$ = this.select(s => s.refreshingItems);
  public readonly mutatingItems$: Observable<T[]> = this.select(
    this.updatingItems$,
    this.deletingItems$,
    (updatingItems, deletingItems) => [...updatingItems, ...deletingItems]
  );

  public readonly isCreating$ = this.select(s => s.isCreating);
  public readonly isReading$ = this.select(s => s.isReading);
  public readonly isUpdating$: Observable<boolean> = this.select(this.updatingItems$, (items) => items.length > 0);
  public readonly isDeleting$: Observable<boolean> = this.select(this.deletingItems$, (items) => items.length > 0);

  public readonly isSaving$: Observable<boolean> = this.select(
    this.isCreating$,
    this.isUpdating$,
    (isCreating, isUpdating) => isCreating || isUpdating
  );
  public readonly isMutating$: Observable<boolean> = this.select(
    this.isCreating$,
    this.isUpdating$,
    this.isDeleting$,
    (isCreating, isUpdating, isDeleting) => isCreating || isUpdating || isDeleting
  );
  public readonly isProcessing$: Observable<boolean> = this.select(
    this.isMutating$,
    this.isReading$,
    this.refreshingItems$,
    (isMutating, isReading, refreshingItems) => isMutating || isReading || refreshingItems.length > 0
  );
  public readonly statuses$ = this.select(s => s.statuses);
  public readonly status$ = this.select(s => s.status);

  protected readonly onCreate = new Subject<T[]>();
  protected readonly onRead = new Subject<T[]>();
  protected readonly onUpdate = new Subject<T[]>();
  protected readonly onDelete = new Subject<Partial<T>[]>();

  protected comparator: ObjectsComparator = new Comparator();
  protected throwOnDuplicates?: string;
  protected allowFetchedDuplicates: boolean = true;
  protected onDuplicateErrCallbackParam = {status: 409};
  protected errReporter?: (...args: any[]) => any;

  protected addToUpdatingItems(item: Partial<T> | Partial<T>[]) {
    this.patchState((s) => {
      const items = Array.isArray(item) ?
        item.map(i => this.getItemByPartial(i, s.items) ?? i as T)
        : [this.getItemByPartial(item, s.items) ?? item as T];
      return {
        updatingItems: this.hasItemIn(item, s.updatingItems) ? s.updatingItems : [
          ...s.updatingItems,
          ...items
        ]
      };
    });
  }

  protected removeFromUpdatingItems(item: Partial<T> | Partial<T>[]) {
    if (Array.isArray(item)) {
      this.patchState((s) => ({
        updatingItems: s.updatingItems.filter(i => !this.has(i, item))
      }));
    } else {
      this.patchState((s) => ({
        updatingItems: s.updatingItems.filter(i => !this.comparator.equal(i, item))
      }));
    }
  }

  protected addToDeletingItems(item: Partial<T> | Partial<T>[]) {
    this.patchState((s) => {
      const items = Array.isArray(item) ?
        item.map(i => this.getItemByPartial(i, s.items) ?? i as T)
        : [this.getItemByPartial(item, s.items) ?? item as T];
      return {
        deletingItems: this.hasItemIn(item, s.deletingItems) ? s.deletingItems : [
          ...s.deletingItems,
          ...items
        ]
      };
    });
  }

  protected removeFromDeletingItems(item: Partial<T> | Partial<T>[]) {
    if (Array.isArray(item)) {
      this.patchState((s) => ({
        deletingItems: s.deletingItems.filter(i => !this.has(i, item))
      }));
    } else {
      this.patchState((s) => ({
        deletingItems: s.deletingItems.filter(i => !this.comparator.equal(i, item))
      }));
    }
  }

  protected addToRefreshingItems(item: Partial<T> | Partial<T>[]) {
    this.patchState((s) => {
      const items = Array.isArray(item) ?
        item.map(i => this.getItemByPartial(i, s.items) ?? i as T)
        : [this.getItemByPartial(item, s.items) ?? item as T];
      return {
        refreshingItems: this.hasItemIn(item, s.refreshingItems) ? s.refreshingItems : [
          ...s.refreshingItems,
          ...items
        ]
      };
    });
  }

  protected removeFromRefreshingItems(item: Partial<T> | Partial<T>[]) {
    if (Array.isArray(item)) {
      this.patchState((s) => ({
        refreshingItems: s.refreshingItems.filter(i => !this.has(i, item))
      }));
    } else {
      this.patchState((s) => ({
        refreshingItems: s.refreshingItems.filter(i => !this.comparator.equal(i, item))
      }));
    }
  }

  protected has(item: Partial<T>, items: Partial<T>[], excludeIndex?: number): boolean {
    if (excludeIndex != null) {
      return !!(items.find((i, j) => j === excludeIndex ? false : this.comparator.equal(item, i)));
    }
    return !!(items.find((i) => this.comparator.equal(item, i)));
  }

  protected getItemByPartial(partItem: Partial<T>, items: T[]): T | undefined {
    return items.find(i => this.comparator.equal(i, partItem));
  }

  protected upsertOne(item: T, items: T[]): T[] | 'duplicate' {
    let firstIndex: number = -1;
    let duplicateIndex: number = -1;
    for (let i = 0; i < items.length; i++) {
      if (this.comparator.equal(item, items[i])) {
        if (firstIndex < 0) {
          firstIndex = i;
        } else {
          duplicateIndex = i;
          break;
        }
      }
    }
    if (firstIndex < 0) {
      items.push(item);
    } else {
      if (duplicateIndex < 0) {
        items[firstIndex] = item;
      } else {
        return 'duplicate';
      }
    }
    return items;
  }

  protected hasDuplicates(items: T[]): T | null {
    if (!Array.isArray(items) || items.length < 2) {
      return null;
    }
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (this.comparator.equal(items[i], items[j])) {
          return items[j];
        }
      }
    }
    return null;
  }

  protected upsertMany(items: T[], toItems: T[]): T[] | {
    duplicate: T,
    preExisting?: boolean
  } {
    const hasDuplicates = this.hasDuplicates(items);
    if (hasDuplicates) {
      return {duplicate: hasDuplicates};
    }
    for (let i = 0; i < items.length; i++) {
      if (this.upsertOne(items[i], toItems) === 'duplicate') {
        return {duplicate: items[i]};
      }
    }
    return toItems;
  }

  protected duplicateNotAdded(item: T, items: T[]) {
    if (this.throwOnDuplicates) {
      throw new Error(this.throwOnDuplicates);
    }
    if (this.errReporter) {
      this.errReporter('Duplicate can not be added to collection:', item, items);
      const duplicates = this.getDuplicates(items);
      if (duplicates) {
        this.errReporter('Duplicates are found in collection:', duplicates);
      }
    }
  }

  protected callCb(cb: ((_: any) => any) | undefined, param: any) {
    if (cb != null) {
      try {
        cb(param);
      } catch (e) {
        this.callErrReporter(e);
      }
    }
  }

  protected callErrReporter(...args: any) {
    if (this.errReporter) {
      try {
        this.errReporter(...args);
      } catch (e) {
        console?.error('errReporter threw an exception', e);
      }
    }
  }

  protected getDecrementedTotalCount<R>(
    response: R[],
    itemsCount: number,
    prevTotalCount?: number,
    decrementTotalCount?: boolean | number | string,
  ): number | null {
    try {
      if (decrementTotalCount != null) {
        if (typeof decrementTotalCount === 'string') {
          if (response.length === 1
            && typeof response[0] === 'object'
            && response[0] != null
          ) {
            const r = response[0] as Record<string, number>;
            if (
              Object.hasOwn(r, decrementTotalCount)
              && typeof r[decrementTotalCount] === 'number'
              && r[decrementTotalCount] >= 0
              && Math.round(r[decrementTotalCount]) === r[decrementTotalCount]
            ) {
              return r[decrementTotalCount];
            }
          }
        } else {
          if (prevTotalCount) {
            if (typeof decrementTotalCount === 'number') {
              const decr = Math.round(decrementTotalCount);
              if (decr === decrementTotalCount && decr > 0 && prevTotalCount >= decr) {
                return prevTotalCount - decrementTotalCount;
              }
            }
            if (typeof decrementTotalCount === 'boolean') {
              if (prevTotalCount >= itemsCount) {
                return prevTotalCount - itemsCount;
              }
            }
          }
        }
      }
    } catch (e) {
      this.callErrReporter(e);
    }
    return null;
  }

  constructor(
    @Inject('COLLECTION_SERVICE_OPTIONS') @Optional() options?: CollectionServiceOptions
  ) {
    super({
      items: [],
      updatingItems: [],
      deletingItems: [],
      refreshingItems: [],
      isReading: false,
      isCreating: false,
      statuses: new Map<T, Set<Status>>(),
      status: new Map<UniqueStatus, T>(),
    });
    this.setOptions(options);
    this.init();
    Promise.resolve().then(() => this.postInit());
  }

  protected init() {

  }

  protected postInit() {

  }

  public create(params: CreateParams<T>): Observable<T> {
    this.patchState({isCreating: true});
    return params.request.pipe(
      finalize(() => this.patchState({isCreating: false})),
      first(),
      concatLatestFrom(() => this.items$),
      tapResponse(
        ([item, items]) => {
          if (item != null) {
            if (!this.hasItemIn(item, items)) {
              this.patchState({items: [...items, item]});
              this.callCb(params.onSuccess, item);
              if (this.onCreate.observed) {
                this.onCreate.next([item]);
              }
            } else {
              this.duplicateNotAdded(item, items);
              this.callCb(params.onError, this.onDuplicateErrCallbackParam);
            }
          }
        },
        (error) => this.callCb(params.onError, error)
      ),
      map(([r]) => r)
    );
  }

  public createMany(params: CreateManyParams<T>): Observable<T[] | FetchedItems<T>> {
    this.patchState({isCreating: true});
    const request = Array.isArray(params.request) ? forkJoin(params.request) : params.request;
    return request.pipe(
      finalize(() => this.patchState({isCreating: false})),
      first(),
      concatLatestFrom(() => this.items$),
      tapResponse(
        ([fetched, items]) => {
          if (fetched != null) {
            const fetchedItems = Array.isArray(fetched) ? fetched : fetched.items;
            if (fetchedItems.length > 0) {
              const newItems = items.slice();
              const result = this.upsertMany(fetchedItems, newItems);
              if (!Array.isArray(result) && result.duplicate) {
                this.duplicateNotAdded(result.duplicate, result.preExisting ? fetchedItems : items);
                this.callCb(params.onError, this.onDuplicateErrCallbackParam);
              } else {
                this.patchState((s) => ({
                  items: [...items, ...fetchedItems],
                  totalCountFetched: Array.isArray(fetched) ? s.totalCountFetched : fetched.totalCount
                }));
                this.callCb(params.onSuccess, fetchedItems);
                if (this.onCreate.observed) {
                  this.onCreate.next(fetchedItems);
                }
              }
            } else {
              if (!Array.isArray(fetched) && fetched.totalCount !== undefined) {
                this.patchState({totalCountFetched: fetched.totalCount});
              }
            }
          }
        },
        (error) => this.callCb(params.onError, error)
      ),
      map(([r]) => r)
    );
  }

  public read(params: ReadParams<T>): Observable<T[] | FetchedItems<T>> {
    this.patchState({isReading: true});
    return params.request.pipe(
      finalize(() => this.patchState({isReading: false})),
      first(),
      tapResponse(
        (fetched) => {
          const items = fetched == null ? ([] as T[]) : (Array.isArray(fetched) ? fetched : fetched.items);
          if (items.length > 0) {
            const duplicate = this.hasDuplicates(items);
            if (duplicate != null) {
              this.duplicateNotAdded(duplicate, items);
              if (!this.allowFetchedDuplicates) {
                if (!params.keepExistingOnError) {
                  this.patchState({items: [], totalCountFetched: undefined});
                }
                this.callCb(params.onError, this.onDuplicateErrCallbackParam);
                return;
              }
            }
          }
          this.patchState({
            items,
            totalCountFetched: Array.isArray(fetched) ? undefined : fetched.totalCount,
          });
          this.callCb(params.onSuccess, items);
          if (this.onRead.observed) {
            this.onRead.next(items);
          }
        },
        (error) => {
          if (!params.keepExistingOnError) {
            this.patchState({items: [], totalCountFetched: undefined});
          }
          this.callCb(params.onError, error);
        }
      )
    );
  }

  public update(params: UpdateParams<T>): Observable<T> {
    this.addToUpdatingItems(params.item);
    return params.request.pipe(
      finalize(() => this.removeFromUpdatingItems(params.item)),
      first(),
      switchMap((newItem) => {
        if (params.refreshRequest) {
          return this.refresh({
            request: params.refreshRequest,
            item: params.item,
            onSuccess: params.onSuccess,
            onError: params.onError,
          });
        } else {
          return this.items$.pipe(
            first(),
            map((items) => {
              if (newItem != null) {
                const newItems = items.slice();
                if (this.upsertOne(newItem, newItems) === 'duplicate') {
                  this.duplicateNotAdded(newItem, items);
                  this.callCb(params.onError, this.onDuplicateErrCallbackParam);
                } else {
                  this.patchState({items: newItems});
                  this.callCb(params.onSuccess, newItem);
                  if (this.onUpdate.observed) {
                    this.onUpdate.next([newItem]);
                  }
                }
              }
              return newItem;
            })
          );
        }
      }),
      catchError((error) => {
        this.callCb(params.onError, error);
        return EMPTY;
      })
    );
  }

  public delete<R = unknown>(params: DeleteParams<T, R>): Observable<R> {
    this.addToDeletingItems(params.item);
    return params.request.pipe(
      finalize(() => this.removeFromDeletingItems(params.item)),
      first(),
      switchMap((response) => {
        if (params.readRequest) {
          return this.read({
            request: params.readRequest,
            onSuccess: params.onSuccess ? () => params.onSuccess?.(response) : undefined,
            onError: params.onError,
          }).pipe(map(_ => response));
        } else {
          return this.items$.pipe(
            concatLatestFrom(() => this.totalCountFetched$),
            first(),
            map(([items, prevTotalCount]) => {
              const newTotalCount = this.getDecrementedTotalCount(
                [response],
                1,
                prevTotalCount,
                params.decrementTotalCount
              );
              const filteredItems = items.filter(item => !this.comparator.equal(item, params.item));
              if (newTotalCount == null) {
                this.patchState({
                  items: filteredItems
                });
              } else {
                this.patchState({
                  items: filteredItems,
                  totalCountFetched: newTotalCount,
                });
              }
              this.callCb(params.onSuccess, response);
              if (this.onDelete.observed) {
                this.onDelete.next([params.item]);
              }
              return response;
            })
          );
        }
      }),
      catchError((error) => {
        this.callCb(params.onError, error);
        return EMPTY;
      })
    );
  }

  public refresh(params: RefreshParams<T>): Observable<T> {
    this.addToRefreshingItems(params.item);
    return params.request.pipe(
      finalize(() => this.removeFromRefreshingItems(params.item)),
      first(),
      concatLatestFrom(() => this.items$),
      tapResponse(
        ([newItem, items]) => {
          if (newItem != null) {
            const newItems = items.slice();
            if (this.upsertOne(newItem, newItems) === 'duplicate') {
              this.duplicateNotAdded(newItem, items);
              this.callCb(params.onError, this.onDuplicateErrCallbackParam);
            } else {
              this.patchState({items: newItems});
              this.callCb(params.onSuccess, newItem);
              if (this.onRead.observed) {
                this.onRead.next([newItem]);
              }
            }
          }
        },
        (error) => this.callCb(params.onError, error)
      ),
      map(([r]) => r)
    );
  }

  public refreshMany(params: RefreshManyParams<T>): Observable<T[] | FetchedItems<T>> {
    this.addToRefreshingItems(params.items);
    const request = Array.isArray(params.request) ? forkJoin(params.request) : params.request;
    return request.pipe(
      finalize(() => this.removeFromRefreshingItems(params.items)),
      first(),
      concatLatestFrom(() => this.items$),
      tapResponse(
        ([fetched, items]) => {
          if (fetched != null) {
            const fetchedItems = Array.isArray(fetched) ? fetched : fetched.items;
            if (fetchedItems.length > 0) {
              const newItems = items.slice();
              const result = this.upsertMany(fetchedItems, newItems);
              if (!Array.isArray(result) && result.duplicate) {
                this.duplicateNotAdded(result.duplicate, result.preExisting ? fetchedItems : items);
                this.callCb(params.onError, this.onDuplicateErrCallbackParam);
              } else {
                this.patchState((s) => ({
                  items: newItems,
                  totalCountFetched: Array.isArray(fetched) ? s.totalCountFetched : fetched.totalCount,
                }));
                this.callCb(params.onSuccess, newItems);
                if (this.onRead.observed) {
                  this.onRead.next(fetchedItems);
                }
              }
            } else {
              if (!Array.isArray(fetched) && fetched.totalCount !== undefined) {
                this.patchState({totalCountFetched: fetched.totalCount});
              }
            }
          }
        },
        (error) => this.callCb(params.onError, error)
      ),
      map(([r]) => r)
    );
  }

  public readOne(params: ReadOneParams<T>): Observable<T> {
    this.patchState({isReading: true});
    return params.request.pipe(
      finalize(() => this.patchState({isReading: false})),
      first(),
      concatLatestFrom(() => this.items$),
      tapResponse(
        ([newItem, items]) => {
          if (newItem != null) {
            const newItems = items.slice();
            if (this.upsertOne(newItem, newItems) === 'duplicate') {
              this.duplicateNotAdded(newItem, items);
              this.callCb(params.onError, this.onDuplicateErrCallbackParam);
            } else {
              this.patchState({items: newItems});
              this.callCb(params.onSuccess, newItem);
              if (this.onRead.observed) {
                this.onRead.next([newItem]);
              }
            }
          }
        },
        (error) => this.callCb(params.onError, error)
      ),
      map(([r]) => r)
    );
  }

  public readMany(params: ReadManyParams<T>): Observable<T[] | FetchedItems<T>> {
    this.patchState({isReading: true});
    const request = Array.isArray(params.request) ? forkJoin(params.request) : params.request;
    return request.pipe(
      finalize(() => this.patchState({isReading: false})),
      first(),
      concatLatestFrom(() => this.state$),
      tapResponse(
        ([fetched, {items, totalCountFetched}]) => {
          const readItems = fetched == null ? ([] as T[]) : (Array.isArray(fetched) ? fetched : fetched.items);
          if (readItems.length > 0) {
            const newItems = items.slice();
            const result = this.upsertMany(readItems, newItems);
            if (!Array.isArray(result) && result.duplicate) {
              this.duplicateNotAdded(result.duplicate, result.preExisting ? readItems : items);
              this.callCb(params.onError, this.onDuplicateErrCallbackParam);
            } else {
              this.patchState({
                items: newItems,
                totalCountFetched: Array.isArray(fetched) ? totalCountFetched : fetched.totalCount,
              });
              this.callCb(params.onSuccess, newItems);
              if (this.onRead.observed) {
                this.onRead.next(readItems);
              }
            }
          } else {
            if (!Array.isArray(fetched) && fetched.totalCount !== undefined) {
              this.patchState({totalCountFetched: fetched.totalCount});
            }
          }
        },
        (error) => this.callCb(params.onError, error)
      ),
      map(([r]) => r)
    );
  }

  public updateMany(params: UpdateManyParams<T>): Observable<T[] | FetchedItems<T>> {
    this.addToUpdatingItems(params.items);
    const request = Array.isArray(params.request) ? forkJoin(params.request) : params.request;
    return request.pipe(
      finalize(() => this.removeFromUpdatingItems(params.items)),
      first(),
      switchMap((updatedItems) => {
        if (params.refreshRequest) {
          return this.refreshMany({
            request: params.refreshRequest,
            items: params.items,
            onSuccess: params.onSuccess,
            onError: params.onError,
          });
        } else {
          return this.items$.pipe(
            first(),
            map((items) => {
              if (updatedItems != null) {
                const newItems = items.slice();
                const result = this.upsertMany(updatedItems, newItems);
                if (!Array.isArray(result) && result.duplicate) {
                  this.duplicateNotAdded(result.duplicate, result.preExisting ? updatedItems : items);
                  this.callCb(params.onError, this.onDuplicateErrCallbackParam);
                } else {
                  this.patchState({items: newItems});
                  this.callCb(params.onSuccess, updatedItems);
                  if (this.onUpdate.observed) {
                    this.onUpdate.next(updatedItems);
                  }
                }
              }
              return updatedItems;
            })
          );
        }
      }),
      catchError((error) => {
        this.callCb(params.onError, error);
        return EMPTY;
      })
    );
  }

  public deleteMany<R = unknown>(params: DeleteManyParams<T, R>): Observable<R[]> {
    this.addToDeletingItems(params.items);
    return forkJoin(Array.isArray(params.request) ? params.request : [params.request]).pipe(
      finalize(() => this.removeFromDeletingItems(params.items)),
      first(),
      switchMap((response) => {
        if (params.readRequest) {
          return this.read({
            request: params.readRequest,
            onSuccess: params.onSuccess ? () => params.onSuccess?.(response) : undefined,
            onError: params.onError,
          }).pipe(map(_ => response));
        } else {
          return this.items$.pipe(
            concatLatestFrom(() => this.totalCountFetched$),
            first(),
            map(([items, prevTotalCount]) => {
              let newTotalCount = this.getDecrementedTotalCount(
                response,
                params.items.length,
                prevTotalCount,
                params.decrementTotalCount
              );

              const newItems = items.filter(item => !this.has(item, params.items));
              if (newTotalCount == null) {
                this.patchState({
                  items: newItems
                });
              } else {
                this.patchState({
                  items: newItems,
                  totalCountFetched: newTotalCount
                });
              }
              this.callCb(params.onSuccess, response);
              if (this.onDelete.observed) {
                this.onDelete.next(params.items);
              }
              return response;
            }));
        }
      }),
      catchError((error) => {
        this.callCb(params.onError, error);
        return EMPTY;
      })
    );
  }

  public hasItemIn<I = T>(item: I, arr: I[]): boolean {
    if (!Array.isArray(arr)) {
      return false;
    }
    return arr.includes(item) || ((arr.findIndex(i => this.comparator.equal(i, item))) > -1);
  }

  public setUniqueStatus(status: UniqueStatus, item: T, active: boolean = true) {
    if (!active) {
      this.patchState((s) => {
        const current = s.status.get(status);
        if (current != null && this.comparator.equal(item, current)) {
          const newMap = new Map(s.status);
          newMap.delete(status);
          return {status: newMap};
        } else {
          return s;
        }
      });
    } else {
      this.patchState((s) => {
        const newMap = new Map(s.status);
        newMap.set(status, item);
        return {status: newMap};
      });
    }
  }

  public deleteUniqueStatus(status: UniqueStatus) {
    this.patchState((s) => {
      const newMap = new Map(s.status);
      newMap.delete(status);
      return {status: newMap};
    });
  }

  public setItemStatus(item: T, status: Status) {
    this.patchState((s) => {
      const newMap = new Map(s.statuses);
      const itemStatuses = newMap.get(item) ?? new Set<Status>();
      itemStatuses.add(status);
      newMap.set(item, itemStatuses);
      return {statuses: newMap};
    });
  }

  public deleteItemStatus(item: T, status: Status) {
    this.patchState((s) => {
      const newMap = new Map(s.statuses);
      const itemStatuses = newMap.get(item);
      if (itemStatuses) {
        itemStatuses.delete(status);
        newMap.set(item, itemStatuses);
        return {statuses: newMap};
      } else {
        return s;
      }
    });
  }

  public getViewModel() {
    return this.select({
      items: this.items$,
      totalCountFetched: this.select(s => s.totalCountFetched),
      isCreating: this.isCreating$,
      isReading: this.isReading$,
      isUpdating: this.isUpdating$,
      isDeleting: this.isDeleting$,
      isMutating: this.isMutating$,
      isSaving: this.isSaving$,
      isProcessing: this.isProcessing$,
      updatingItems: this.updatingItems$,
      deletingItems: this.deletingItems$,
      mutatingItems: this.mutatingItems$,
      refreshingItems: this.refreshingItems$,
      statuses: this.statuses$,
      status: this.status$,
    });
  }

  public getItemViewModel(itemSource: Observable<T | undefined>) {
    return this.select({
      isDeleting: this.select(
        this.deletingItems$,
        itemSource.pipe(startWith(undefined)),
        (items, item) => !!item && this.hasItemIn(item, items)
      ),
      isRefreshing: this.select(
        this.refreshingItems$,
        itemSource.pipe(startWith(undefined)),
        (items, item) => !!item && this.hasItemIn(item, items)
      ),
      isUpdating: this.select(
        this.updatingItems$,
        itemSource.pipe(startWith(undefined)),
        (items, item) => !!item && this.hasItemIn(item, items)
      ),
      isMutating: this.select(
        this.mutatingItems$,
        itemSource.pipe(startWith(undefined)),
        (items, item) => !!item && this.hasItemIn(item, items)
      ),
      isProcessing: this.select(
        this.isProcessing$,
        this.refreshingItems$,
        this.mutatingItems$,
        itemSource.pipe(startWith(undefined)),
        (isProcessing, refreshingItems, mutatingItems, item) => !!item
          && isProcessing
          && (this.hasItemIn(item, refreshingItems) || this.hasItemIn(item, mutatingItems))
      ),
    });
  }

  public getItem(filter: Partial<T> | Observable<Partial<T>>): Observable<T | undefined> {
    if (isObservable(filter)) {
      return this.select(
        filter.pipe(startWith(undefined)),
        this.items$,
        (item, items) => item ? this.getItemByPartial(item, items) : undefined
      );
    } else {
      return this.select(
        this.items$,
        (items) => this.getItemByPartial(filter, items)
      );
    }
  }

  public getItemByField<K extends keyof T>(field: K | K[], fieldValue: T[K] | Observable<T[K]>): Observable<T | undefined> {
    const fields = Array.isArray(field) ? field : [field];
    if (isObservable(fieldValue)) {
      return this.select(
        fieldValue.pipe(startWith(undefined)),
        this.items$,
        (fieldValue, items) => fieldValue != null ?
          items.find((i) =>
            fields.find((f) => i[f] === fieldValue) !== undefined
          )
          : undefined
      );
    } else {
      return this.select(
        this.items$,
        (items) => items.find((i) =>
          fields.find((f) => i[f] === fieldValue) !== undefined
        )
      );
    }
  }

  public setComparator(comparator: ObjectsComparator | ObjectsComparatorFn) {
    if (typeof comparator === 'function') {
      this.comparator = {equal: comparator};
    } else {
      this.comparator = comparator;
    }
  }

  public getDuplicates(items: T[]): DuplicatesMap<T> | null {
    if (!Array.isArray(items) || items.length < 2) {
      return null;
    }
    const duplicates: DuplicatesMap<T> = {};
    let hasDupes = false;
    for (let ii = 0; ii < items.length; ii++) {
      const iDupes: Record<number, T> = {};
      let itemHasDupes = false;
      const i = items[ii];
      for (let ij = ii + 1; ij < items.length; ij++) {
        const j = items[ij];
        if (this.comparator.equal(i, j)) {
          iDupes[ij] = j;
          itemHasDupes = true;
        }
      }
      if (itemHasDupes) {
        hasDupes = true;
        iDupes[ii] = i;
        duplicates[ii] = iDupes;
      }
    }
    return hasDupes ? duplicates : null;
  }

  public setThrowOnDuplicates(message: string | undefined) {
    this.throwOnDuplicates = message;
  }

  public setAllowFetchedDuplicates(allowFetchedDuplicates: boolean) {
    this.allowFetchedDuplicates = allowFetchedDuplicates;
  }

  public setOnDuplicateErrCallbackParam(onDuplicateErrCallbackParam: any) {
    this.onDuplicateErrCallbackParam = onDuplicateErrCallbackParam;
  }

  public getTrackByFieldFn(field: string): (i: number, item: any) => any {
    return (i: number, item: any) => {
      try {
        return (!!item
          && typeof item === 'object'
          && Object.hasOwn(item, field)
          && !isEmptyValue(item[field])
        ) ? item[field] : i;
      } catch (e) {
        this.callErrReporter(e);
        return i;
      }
    };
  }

  public setOptions(options?: CollectionServiceOptions) {
    if (options != null) {
      if (options.comparator) {
        this.setComparator(options.comparator);
      } else {
        if (options.comparatorFields != null) {
          this.comparator = new Comparator(options.comparatorFields);
        }
      }
      if (options.throwOnDuplicates) {
        this.throwOnDuplicates = options.throwOnDuplicates;
      }
      if (typeof options.allowFetchedDuplicates === 'boolean') {
        this.allowFetchedDuplicates = options.allowFetchedDuplicates;
      }
      if (options.onDuplicateErrCallbackParam != null) {
        this.onDuplicateErrCallbackParam = options.onDuplicateErrCallbackParam;
      }
      if (options.errReporter != null && typeof options.errReporter === 'function') {
        this.errReporter = options.errReporter;
      }
    }
  }

  public listenForCreate(): Observable<T[]> {
    return this.onCreate.asObservable();
  }

  public listenForRead(): Observable<T[]> {
    return this.onRead.asObservable();
  }

  public listenForUpdate(): Observable<T[]> {
    return this.onUpdate.asObservable();
  }

  public listenForDelete(): Observable<Partial<T>[]> {
    return this.onDelete.asObservable();
  }
}
