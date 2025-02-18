/**
 * @package admin
 */

import Vue from 'vue';
import type { Module } from 'vuex_v2';
import type { uiTabsAddTabItem } from '@shopware-ag/admin-extension-sdk/es/ui/tabs';

// eslint-disable-next-line sw-deprecation-rules/private-feature-declarations
export type TabItemEntry = Omit<uiTabsAddTabItem, 'responseType' | 'positionId'>;

interface TabsState {
    tabItems: {
        [positionId: string]: TabItemEntry[]
    }
}

const TabsStore: Module<TabsState, VuexRootState> = {
    namespaced: true,

    state: (): TabsState => ({
        tabItems: {},
    }),

    mutations: {
        addTabItem(state, { label, componentSectionId, positionId }: uiTabsAddTabItem) {
            if (!state.tabItems[positionId]) {
                if (window._features_?.vue3) {
                    state.tabItems[positionId] = [];
                } else {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                    Vue.set(state.tabItems, positionId, []);
                }
            }

            state.tabItems[positionId].push({
                label,
                componentSectionId,
            });
        },
    },
};

/**
 * @deprecated tag:v6.6.0 - Will be private
 */
export default TabsStore;

// eslint-disable-next-line sw-deprecation-rules/private-feature-declarations
export type { TabsState };
