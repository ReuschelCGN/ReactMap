import * as React from 'react'
import type { ButtonProps, SxProps, Theme } from '@mui/material'
import { SystemStyleObject } from '@mui/system'

import { UAssets } from '@services/Assets'
import { Config } from './config'
import { AdvCategories, Permissions } from '@rm/types'

declare global {
  declare const CONFIG: Config<true>

  interface Window {
    uicons?: UAssets
    uaudio?: UAssets
  }
}

export interface CustomI extends React.HTMLProps<HTMLLIElement> {
  size?: ButtonProps['size']
}

export type TimesOfDay = 'day' | 'night' | 'dawn' | 'dusk'

export type Theme = 'light' | 'dark'

export type TileLayer = {
  name: string
  style: import('@rm/types').Theme
  attribution?: string
  url?: string
  background?: string
} & { [key in TimesOfDay]?: string }

export type MarginProps = {
  [Key in
    | 'm'
    | 'mt'
    | 'mb'
    | 'ml'
    | 'mr'
    | 'mx'
    | 'my']?: React.CSSProperties['margin']
}

export type PaddingProps = {
  [Key in
    | 'p'
    | 'pt'
    | 'pb'
    | 'pl'
    | 'pr'
    | 'px'
    | 'py']?: React.CSSProperties['padding']
}

export interface MultiSelectorProps<V> {
  value: V
  items: readonly V[]
  tKey?: string
  disabled?: boolean
  onClick?: (
    oldValue: V,
    newValue: V,
  ) => (e?: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void
}

export interface FilterObj {
  name: string
  perms: (keyof Permissions)[]
  webhookOnly?: boolean
  searchMeta?: string
  category?: AdvCategories
  pokedexId?: number
  formId?: number
  defaultFormId?: number
  pokeName?: string
  formName?: string
  formTypes?: string[]
  rarity?: string
  historic?: string
  legendary?: boolean
  mythical?: boolean
  ultraBeast?: boolean
  genId?: string
  family?: number
}

export type ClientFilterObj = Record<string, Record<string, FilterObj>>
