// @ts-check
import * as React from 'react'
import ListItem from '@mui/material/ListItem'

import { useStorage } from '@store/useStorage'
import { useMemory } from '@store/useMemory'
import { QUEST_SETS } from '@assets/constants'
import { MultiSelectorStore } from '@components/inputs/MultiSelector'

import { CollapsibleItem } from '../components/CollapsibleItem'
import { MultiSelectorList, SelectorListMemo } from '../components/SelectorList'

const BaseQuestQuickSelect = () => {
  const enabled = useStorage((s) => !!s.filters?.pokestops?.quests)
  const { enableQuestSetSelector } = useMemory.getState().config.misc
  return enableQuestSetSelector ? (
    <CollapsibleItem open={enabled}>
      <ListItem>
        <MultiSelectorStore
          field="filters.pokestops.showQuestSet"
          items={QUEST_SETS}
        />
      </ListItem>
      <MultiSelectorList tabKey="quests">
        <SelectorListMemo
          key="items"
          category="pokestops"
          subCategory="quests"
          label="search_quests"
          height={350}
        />
        <SelectorListMemo
          key="pokemon"
          category="pokestops"
          subCategory="pokemon"
          label="search_quests"
          height={350}
        />
      </MultiSelectorList>
    </CollapsibleItem>
  ) : (
    <CollapsibleItem open={enabled}>
      <MultiSelectorList tabKey="quests">
        <SelectorListMemo
          key="items"
          category="pokestops"
          subCategory="quests"
          label="search_quests"
          height={350}
        />
        <SelectorListMemo
          key="pokemon"
          category="pokestops"
          subCategory="pokemon"
          label="search_quests"
          height={350}
        />
      </MultiSelectorList>
    </CollapsibleItem>
  )
}

export const QuestQuickSelect = React.memo(BaseQuestQuickSelect)
