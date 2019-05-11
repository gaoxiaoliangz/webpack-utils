const _ = require('lodash')
const webpackMerge = require('webpack-merge')
const baseConfig = require('./webpack.base.config')
const Features = require('./features')
const { essDep } = require('./constants')
const { isDepInstalled, print, resolveProject } = require('../utils')
const { mergeTargets } = require('./merge-targets')
const { capFirst } = require('./case')

const DEFAULT_CONTEXT = {
  production: false,
  scopedClassName: null
}

const getDeps = features => {
  const deps = _.reduce(features, (deps, f) => {
    return [...deps, ...f.dependency || []]
  }, [])
  return _.union(deps)
}

/**
 * validate features
 * @param {{instance, name}[]} features feature instances
 */
const validateFeatures = features => {
  const featureErrs = features
    .map(f => {
      return f.validate({
        name: 'feature ' + f.__type
      })
    })
    .filter(Boolean)

  if (featureErrs.length > 0) {
    throw new TypeError(featureErrs.map(err => {
      return err + '\n'
    }))
  }

  // validate dependency
  const deps = getDeps(features)
  const missingDeps = [...deps, ...essDep].filter(dep => {
    return !isDepInstalled(dep)
  })
  const hint = `Some packages are not installed, install these packages by running\n\nyarn add ${missingDeps.join(' ')} --dev\n`

  if (missingDeps.length !== 0) {
    throw new TypeError(hint)
  }

  if (features.find(f => f.key === 'typescript')) {
    try {
      require.resolve(resolveProject('tsconfig.json'))
    } catch (error) {
      throw new TypeError('When enabling typescript, tsconfig.json is required!\nYou can use `jellyweb init --ts` to generate one')
    }
  }
}

function preprocessJellyConfig(config = {}) {
  const contextKeys = _.keys(DEFAULT_CONTEXT)
  return {
    context: _.pick(config, contextKeys),
    features: _.mapValues(_.pickBy(_.omit(config, contextKeys), Boolean), val => {
      return typeof val !== 'object'
        ? {}
        : val
    })
  }
}

exports.preprocessJellyConfig = preprocessJellyConfig

/**
 * generate webpack config
 * @param {*} jellyConfig Function userConfig => { feature, userConfig }
 * @param {Object} webpackConfig
 * @param {Object} webpackConfig.entry
 * @param {Object} webpackConfig.output
 * @param {String} webpackConfig.output.filename
 * @param {String} webpackConfig.output.path
 * @param {'source-map' | 'inline-source-map'} webpackConfig.devtool
 */
function configWebpack(jellyConfig, webpackConfig) {
  let features
  try {
    const { features: allFeatures, context } = preprocessJellyConfig(jellyConfig)
    features = _.map(allFeatures, (fConfig, fName) => {
      const name = capFirst(fName)
      const Feature = Features[name]
      if (!Feature) {
        throw new TypeError(`Invalid feature '${fName}'`)
      }
  
      const feature = new Feature({
        userConfig: fConfig,
        features: allFeatures,
        context
      })
  
      feature.__type = fName
      return feature
    })
    validateFeatures(features)
  } catch (error) {
    print.error(error)
    process.exit(0)
  }

  const targets = _.flatten(features.map((feature) => feature.eval())).filter(Boolean)
  const webpackConfig0 = mergeTargets(targets)
  const merged = webpackMerge({}, baseConfig({
    verbose: false,
    debug: true,
  }), webpackConfig0, webpackConfig)

  const fileRule = _.find(merged.module.rules, { __type: 'File' })
  const removeRuleType = r => _.omit(r, ['__type'])

  if (fileRule) {
    merged.module.rules = [{
      oneOf: [
        ...merged.module.rules.filter(rule => rule.__type !== 'File'),
        ...[fileRule]
      ]
        .map(removeRuleType)
    }]
  } else {
    merged.module.rules = merged.module.rules.map(removeRuleType)
  }
  return merged
}

exports.configWebpack = configWebpack