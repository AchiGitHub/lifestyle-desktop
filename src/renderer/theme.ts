import { createTheme, type MantineColorsTuple } from '@mantine/core'

// Built around the old app's navy (#153462, shade 8).
const brand: MantineColorsTuple = [
  '#ebf0f8',
  '#d3dcec',
  '#a4b7d9',
  '#7290c6',
  '#4a70b6',
  '#335cab',
  '#2652a6',
  '#1b4391',
  '#153462',
  '#0d2447'
]

// Accent from the LSFS logo.
const flame: MantineColorsTuple = [
  '#fff1e6',
  '#ffe0cc',
  '#ffbf99',
  '#ff9b61',
  '#ff7e34',
  '#ff6b17',
  '#ff6107',
  '#e35000',
  '#ca4600',
  '#b03900'
]

export const theme = createTheme({
  primaryColor: 'brand',
  // Navy on light; a lighter blue on dark, where navy buttons and links would be hard to see.
  primaryShade: { light: 8, dark: 5 },
  colors: { brand, flame },
  defaultRadius: 'md',
  fontFamily: '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif',
  headings: { fontFamily: '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif', fontWeight: '650' },
  components: {
    Paper: { defaultProps: { withBorder: true, radius: 'md' } },
    Card: { defaultProps: { withBorder: true, radius: 'md' } },
    Modal: { defaultProps: { centered: true, overlayProps: { blur: 2 } } },
    NumberInput: { defaultProps: { thousandSeparator: ',', hideControls: true } }
  }
})
