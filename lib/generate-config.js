const _ = require('lodash')
const webpackMerge = require('webpack-merge')
const webpackRules = require('./rules')
const { isDepInstalled, resolveApp } = require('./utils')
const featuresConfig = require('./features.config')
const baseConfig = require('./base.config')
const exampleTsconfig = require('./example-tsconfig')

const featuresObj = featuresConfig.features

const getDeps = features => {
  const defaultFeatures = _.mapValues(featuresObj, f => Boolean(f.enableByDefault))
  const userFeatures = _.mapValues(features, Boolean)
  const enabled = _.pick(featuresObj, Object.keys(_.pickBy(Object.assign({}, defaultFeatures, userFeatures), Boolean)))
  const deps = _.filter(enabled, f => f.dep).map(feature => feature.dep)
  const deps2 = _.flatten(deps)
  return _.union(deps2)
}

/**
 * @param {(string | {})[]} features
 * @return {{[rule: string]: { priority?: number, feature: { name: string, config: {} } }[]}[]}
 */
const getRuleConfig = features => {
  const featureNames = _.map(features, (v, k) => v ? k : undefined).filter(Boolean)
  const featureWithRule = _.map(featureNames, name => {
    const rule = _.get(featuresObj, [name, 'rule'])
    if (!rule) {
      return
    }
    return {
      feature: name,
      rule
    }
  })
    .filter(Boolean)

  const rules = _.groupBy(featureWithRule, feature => {
    return feature.rule
  })

  return _.mapValues(rules, ruleFeatures => {
    return ruleFeatures.map(f => {
      const featureName = f.feature
      return {
        priority: featuresObj[featureName].priority,
        feature: {
          name: featureName,
          config: typeof features[featureName] === 'object' ? features[featureName] : undefined
        }
      }
    })
  })
}

/**
 * @param {{[rule: string]: { priority?: number, feature: { name: string, config: {} } }[]}[]} features
 */
const createRules = features => {
  const rules = getRuleConfig(features)
  return _.reduce(rules, (allRules, ruleConfigs, ruleName) => {
    const ruleConfig = ruleConfigs.sort((r1, r2) => {
      return r1.priority - r2.priority
    })
      .map(rule => {
        const defaultRuleConfig = featuresObj[rule.feature.name].defaultRuleConfig || {}
        return _.merge({}, defaultRuleConfig, rule.feature.config)
      })
      .reduce((finalConfig, config) => {
        return Object.assign({}, finalConfig, config)
      }, {})

    const webpackRule = webpackRules[ruleName](ruleConfig)
    return [...allRules, ..._.castArray(webpackRule)]
  }, [])
}

/**
 * @param {{features: { [feature: string]: {} }}} config 
 * features: 'polyfill' | 'react' | 'sass' | 'compress' | 'node' | 'babel' | 'postcss' | 'css' | 'typescript'
 */
function generateConfig(config, webpackConfig) {
  const { features } = config
  const deps = getDeps(features)

  const missingDeps = [...deps, ...featuresConfig.essDep].filter(dep => {
    return !isDepInstalled(dep)
  })

  const hint = `ERROR: Some packages are not installed, install these packages by running\n\nyarn add ${missingDeps.join(' ')} --dev\n`

  if (missingDeps.length !== 0) {
    console.error(hint)
    process.exit(1)
  }

  if (features.typescript) {
    try {
      require.resolve(resolveApp('tsconfig.json'))
    } catch (error) {
      console.error('When enabling typescript tsconfig.json is requierd! You can use the following config as a template')
      console.log(exampleTsconfig)
      process.exit(1)
    }    
  }

  const cssAndJsRules = createRules(features)
  let rules
  if (features.media === false) {
    rules = cssAndJsRules
  } else {
    const { loadImgWithUrlLoader } = Object.assign({}, featuresObj.media, features.media)
    rules = [
      {
        oneOf: [
          ...loadImgWithUrlLoader ? [webpackRules.image()] : [],
          ...cssAndJsRules,
          webpackRules.file()
        ]
      }
    ]
  }

  const merged = webpackMerge({}, baseConfig, {
    module: {
      rules
    }
  }, webpackConfig)

  if (!merged.entry) {
    console.error('ERROR: Missing entry!')
    process.exit(1)
  }

  if (!merged.output) {
    console.error('ERROR: Missing output!')
    process.exit(1)
  }

  if (features.polyfill) {
    const hasPolyfill = _.find(merged.entry, paths => {
      if (typeof paths === 'string') {
        return paths.includes('babel-polyfill')
      }
      return paths.some(p => {
        return p.includes('babel-polyfill')
      })
    })
    if (!hasPolyfill) {
      console.error('WARNING: `babel-polyfill` should be placed in one of you entry config in order to work!')
    }
  }
  return merged
}

module.exports = generateConfig