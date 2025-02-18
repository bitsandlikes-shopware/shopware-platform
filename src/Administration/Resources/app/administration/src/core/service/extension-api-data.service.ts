/**
 * @package admin
 */

import { updateSubscriber, register, handleGet } from '@shopware-ag/admin-extension-sdk/es/data';
import { get, debounce } from 'lodash';
import { selectData } from '@shopware-ag/admin-extension-sdk/es/data/_internals/selectData';
import MissingPrivilegesError from '@shopware-ag/admin-extension-sdk/es/privileges/missing-privileges-error';

interface scopeInterface {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $set(target: object, key: string, value: any): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $watch(path: string, callback: (value: any) => void, options: { deep: boolean, immediate: boolean }): () => void;
    $once(event: string, callback: () => void): void;
}
interface publishOptions {
    id: string,
    path: string,
    scope: scopeInterface
}

type dataset = {
    id: string,
    scope: number,
    data: unknown
}

type transferObject = {
    [key: string|symbol]: unknown
}

type ParsedPath = {
    pathToLastSegment: string,
    lastSegment: string,
};

type vueWithUid = Partial<Vue> & { _uid: number };

// This is used by the Vue devtool extension plugin
let publishedDataSets: dataset[] = [];

handleGet((data, additionalOptions) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const origin = additionalOptions?._event_?.origin;
    const registeredDataSet = publishedDataSets.find(s => s.id === data.id);

    if (!registeredDataSet) {
        return null;
    }

    const selectors = data.selectors;

    if (!selectors) {
        return registeredDataSet.data;
    }

    const selectedData = selectData(registeredDataSet.data, selectors, 'datasetGet', origin);

    if (selectedData instanceof MissingPrivilegesError) {
        console.error(selectedData);
    }

    return selectedData;
});

/**
 * Splits an object path like "foo.bar.buz" to "{ pathToLastSegment: 'foo.bar', lastSegment: 'buz' }".
 */
function parsePath(path :string): ParsedPath | null {
    if (!path.includes('.')) {
        return null;
    }

    const properties = path.split('.');
    const lastSegment = properties.pop();
    const pathToLastSegment = properties.join('.');

    if (lastSegment && lastSegment.length && pathToLastSegment && pathToLastSegment.length) {
        return {
            pathToLastSegment,
            lastSegment,
        };
    }

    return null;
}

// eslint-disable-next-line sw-deprecation-rules/private-feature-declarations
export function publishData({ id, path, scope }: publishOptions): void {
    const registeredDataSet = publishedDataSets.find(s => s.id === id);

    // Dataset registered from different scope? Prevent update.
    if (registeredDataSet && registeredDataSet.scope !== (scope as vueWithUid)._uid) {
        console.error(`The dataset id "${id}" you tried to publish is already registered.`);

        return;
    }

    // Dataset registered from same scope? Update.
    if (registeredDataSet && registeredDataSet.scope === (scope as vueWithUid)._uid) {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        register({ id: id, data: get(scope, path) }).catch(() => {});

        return;
    }

    // Create updateSubscriber which maps back changes from the app to Vue
    updateSubscriber(id, (value) => {
        // Null updates are not allowed
        if (!value) {
            return;
        }

        function setObject(transferObject: transferObject, prePath: string|null = null): void {
            if (typeof transferObject?.getIsDirty === 'function' && !transferObject.getIsDirty()) {
                return;
            }

            Object.keys(transferObject).forEach((property) => {
                let realPath : string;
                if (prePath) {
                    realPath = `${prePath}.${property}`;
                } else {
                    realPath = `${path}.${property}`;
                }

                const parsedPath = parsePath(realPath);
                if (parsedPath === null) {
                    return;
                }

                // @ts-expect-error
                // eslint-disable-next-line max-len
                if (Shopware.Utils.hasOwnProperty(transferObject[property], 'getDraft', this) && typeof transferObject[property].getDraft === 'function') {
                    setObject({ [property]: Shopware.Utils.object.cloneDeep(transferObject[property]) }, realPath);

                    return;
                }

                if (Array.isArray(transferObject[property])) {
                    (transferObject[property] as Array<unknown>).forEach((c, index) => {
                        setObject({ [index]: c }, realPath);
                    });

                    return;
                }

                scope.$set(
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                    Shopware.Utils.object.get(scope, parsedPath.pathToLastSegment),
                    parsedPath.lastSegment,
                    transferObject[property],
                );
            });
        }

        // @ts-expect-error
        if (typeof value.data?.getDraft === 'function') {
            setObject(value.data as transferObject);

            return;
        }

        if (Array.isArray(value.data)) {
            value.data.forEach((entry, index) => {
                if (entry === null || typeof entry !== 'object') {
                    return;
                }

                setObject({ [index]: entry as unknown });
            });
        } else if (typeof value.data === 'object') {
            setObject(value.data as transferObject);

            return;
        }

        // Vue.set does not resolve path's therefore we need to resolve to the last child property
        if (path.includes('.')) {
            const properties = path.split('.');
            const lastPath = properties.pop();
            const newPath = properties.join('.');
            if (!lastPath) {
                return;
            }

            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            scope.$set(Shopware.Utils.object.get(scope, newPath), lastPath, value.data);

            return;
        }

        scope.$set(scope, path, value.data);
    });

    // Watch for Changes on the Reactive Vue property and automatically publish them
    const unwatch = scope.$watch(path, debounce((value: Vue) => {
        // const preparedValue = prepareValue(value);

        // eslint-disable-next-line @typescript-eslint/no-empty-function
        register({ id: id, data: value }).catch(() => {});

        const dataSet = publishedDataSets.find(set => set.id === id);
        if (dataSet) {
            dataSet.data = value;

            return;
        }

        publishedDataSets.push({
            id,
            data: value,
            scope: (scope as vueWithUid)._uid,
        });
    }, 750), {
        deep: true,
        immediate: true,
    });

    // Before the registering component gets destroyed, destroy the watcher and deregister the dataset
    scope.$once('hook:beforeDestroy', () => {
        publishedDataSets = publishedDataSets.filter(value => value.id !== id);

        unwatch();
    });

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    register({ id: id, data: get(scope, path) }).catch(() => {});
}

// eslint-disable-next-line sw-deprecation-rules/private-feature-declarations
export function getPublishedDataSets(): dataset[] {
    return publishedDataSets;
}
