### 1.4.1
Accept Angular 16 as peerDependency.

### 1.4.0
* `delete()` and `deleteMany()` now have 2 new optional fields in their params:
  * `readRequest`: consecutive `read()` request (will completely reset `items`);
  * `decrementTotalCount`: decrement `totalCountFetched` by count of removed items, by number, or read new value from the response object.
* Angular and NgRx versions bump, RxJS 7 & 8 versions are supported.

### 1.3.0
You can now get an observable to be notified about the mutations:
* `listenForCreate()`
* `listenForRead()`
* `listenForUpdate()`
* `listenForDelete()`
Events will be only emitted if there are active observers.

### 1.2.9

* Comparator now accepts dot-separated paths;
* onSuccess/onError callbacks are wrapped with `try...catch` now (will try to use `errReporter` in case of exception);
* errReporter is wrapped with `try...catch` now (in case of exception raised by `errReporter`, will try to use `console.error`, if exist).

### 1.2.8
* User `errReporter` to report errors, and don't use `console` by default.
* `Comparator` class (and `comparatorFields` parameter) now understand composite fields.
* Update NgRx dependencies to v15 (stable).

### 1.2.7
* Restore global configuration feature (`COLLECTION_SERVICE_OPTIONS` token)

### 1.2.5
* Make constructors empty (for some reason Angular complains that constructors with arguments are not compatible with dependency injection, although it only happens if code is published to npm).
* make `setOptions()` public.

### 1.2.1
* Optimize speed of duplicate detection in `read()`
* Add `"emitDecoratorMetadata": true` to tsconfig

### 1.2.0
* New (additional) methods: 
  * `createMany()`
  * `refreshMany()`
  * `updateMany()`
  * `deleteMany()`
* `request` parameter will now accept an array of requests (to `forkJoin()` them) in:
  * `createMany()`
  * `readMany()`
  * `refreshMany()`
  * `updateMany()`
  * `deleteMany()`  
  Requests with suffix `*many` will run in parallel (using `forkJoin()`). If you need to run them differently, you can use regular methods with the [creation operator](https://rxjs.dev/guide/operators#creation-operators-1) of your choice.
* A function can be used as a value for the `comparator` field in configuration options or as an argument for `setComparator()` method;
* New method for override: `postInit()` - will be called in the next microtask after `constructor()`.   
  You can override and use it to call the methods declared in the subclass and still don't bother about `constructor()` overriding;
* `getTrackByFieldFn()` helper will not use fields with empty values;
* Jest has been configured to run tests in this repo - pull requests are welcome!

## 1.1.1
* `readMany()` should update `totalCountFetched` if provided

## 1.1.0
* `onDuplicateErrCallbackParam` added to configuration options.
* type restriction for `item` parameter is relaxed to Partial<T>. It was possible to use partial objects before, but it was not obvious from signatures.
* New methods `readOne()`, `readMany()`, `getItem()`, `getItemByField()` have been added and documented.
* Removed synchronous check from `setUniqueStatus()` when `active = false`. It was the only synchronous call in code.  

## 1.0.10
* Update dependencies to Angular 15 release version
* Add file with test to the repo
* Add `deleteItemStatus()` method

## 1.0.9
You can (optionally) declare Collection Service configuration details in your module or component providers:
```ts
providers: [
  {
    provide: 'COLLECTION_SERVICE_OPTIONS',
    useValue: {
      allowFetchedDuplicates: environment.production,
    }
  },
]
```
Token `COLLECTION_SERVICE_OPTIONS` is just a string to don't break lazy-loading (if you are using it).

Options structure:
```ts
interface CollectionServiceOptions {
  comparatorFields?: string[];
  throwOnDuplicates?: string;
  allowFetchedDuplicates?: boolean; // if not set: true
}
```

## 1.0.8
* Fix itemViewModel.isProcessing; 
* Make all selectors in `itemViewModel` protected from streams without pre-emitted value;
* Add `getTrackByFieldFn()` helper function.

## 1.0.7
* `read()` now accepts usual arrays also;
* Info about duplicates prevention has been added to README.
