import { describe, it, expect } from 'vitest'
import { MODELS, getModel } from './models'
import { modelWeight, normalizedWeights } from './weighting'

const PARIS = { lat: 48.85, lon: 2.35 }
const SAHARA = { lat: 23, lon: 10 }
const SYDNEY = { lat: -33.87, lon: 151.21 }

describe('modelWeight', () => {
  it('drops a CAM beyond its 60h decay window', () => {
    const arome = getModel('meteofrance_seamless')!
    expect(modelWeight(arome, 6, PARIS.lat, PARIS.lon, 'temperature_2m')).toBeGreaterThan(0)
    expect(modelWeight(arome, 24, PARIS.lat, PARIS.lon, 'temperature_2m')).toBeGreaterThan(0)
    expect(modelWeight(arome, 80, PARIS.lat, PARIS.lon, 'temperature_2m')).toBe(0)
  })

  it('keeps globals running through medium range', () => {
    const ecmwf = getModel('ecmwf_ifs025')!
    expect(modelWeight(ecmwf, 6, PARIS.lat, PARIS.lon, 'temperature_2m')).toBeGreaterThan(0)
    expect(modelWeight(ecmwf, 168, PARIS.lat, PARIS.lon, 'temperature_2m')).toBeGreaterThan(0)
  })

  it('gives a regional model more weight inside its home region', () => {
    const arome = getModel('meteofrance_seamless')!
    const home = modelWeight(arome, 6, PARIS.lat, PARIS.lon, 'temperature_2m')
    const away = modelWeight(arome, 6, SAHARA.lat, SAHARA.lon, 'temperature_2m')
    expect(home).toBeGreaterThan(away)
  })

  it('boosts CAMs for precipitation', () => {
    const arome = getModel('meteofrance_seamless')!
    const temp = modelWeight(arome, 6, PARIS.lat, PARIS.lon, 'temperature_2m')
    const precip = modelWeight(arome, 6, PARIS.lat, PARIS.lon, 'precipitation')
    expect(precip).toBeGreaterThan(temp)
  })

  it('returns zero past the model horizon', () => {
    const knmi = getModel('knmi_seamless')!
    expect(modelWeight(knmi, 120, PARIS.lat, PARIS.lon, 'temperature_2m')).toBe(0)
  })
})

describe('normalizedWeights', () => {
  it('always sums to 1 across contributing models', () => {
    const w = normalizedWeights(MODELS, 24, PARIS.lat, PARIS.lon, 'temperature_2m')
    const sum = Array.from(w.values()).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 5)
  })

  it('excludes models with zero weight (past their horizon)', () => {
    const w = normalizedWeights(MODELS, 200, PARIS.lat, PARIS.lon, 'temperature_2m')
    // CAMs (60h horizon) must be gone; ECMWF + GFS must remain.
    expect(w.has('meteofrance_seamless')).toBe(false)
    expect(w.has('knmi_seamless')).toBe(false)
    expect(w.has('ecmwf_ifs025')).toBe(true)
    expect(w.has('gfs_global')).toBe(true)
  })

  it('puts more weight on BOM ACCESS-G near Sydney than near Paris', () => {
    const sydneyW = normalizedWeights(MODELS, 24, SYDNEY.lat, SYDNEY.lon, 'temperature_2m')
    const parisW = normalizedWeights(MODELS, 24, PARIS.lat, PARIS.lon, 'temperature_2m')
    expect(sydneyW.get('bom_access_global')!).toBeGreaterThan(parisW.get('bom_access_global')!)
  })
})
