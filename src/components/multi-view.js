import { warn } from '../util/warn'
import { activateChildComponent, deactivateChildComponent } from '../util/lifecycle'

function updateActive (isCurrent, cached, vm) {
  if (cached.active !== isCurrent) {
    if (vm) {
      if (isCurrent) {
        activateChildComponent(vm, true)
      } else {
        deactivateChildComponent(vm, true)
      }
      vm._inactive = !isCurrent
    }
    cached.active = isCurrent
  }
}

function getEffectiveRoute(key, currentRoute) {
  let effectiveRoute = key;
  // Fetch url params names
  const tokensRegex = /.*:([a-zA-Z0-9]+)\/?.*/g;
  const matchedTokens = tokensRegex.exec(key);
  const queryParamsName =
    matchedTokens && matchedTokens.length && matchedTokens.length > 1
      ? matchedTokens.slice(1)
      : [];
  queryParamsName.forEach(paramName => {
    if (currentRoute.params && currentRoute.params[paramName]) {
      effectiveRoute = effectiveRoute.replace(
        new RegExp(`:${paramName}`, "g"),
        currentRoute.params[paramName]
      );
    }
  });
  return effectiveRoute;
}

export default {
  name: 'RouterView',
  functional: true,
  props: {
    viewName: {
      type: String,
      default: 'default',
    },
    morph: {
      type: [String, Object, Function],
      default: 'div',
    },
    forceMultiViews: {
      type: Boolean,
      default: false,
    },
  },
  render (_, { props, parent, data, children }) {
    // directly use parent context's createElement() function
    // so that components rendered by router-view can resolve named slots
    const h = parent.$createElement
    const name = props.viewName
    const route = parent.$route
    const bigCache = parent._routerViewCache || (parent._routerViewCache = {})

    // determine current view depth, also check to see if the tree
    // has been toggled inactive but kept-alive.
    let depth = 0
    let inactive = false
    while (parent && parent._routerRoot !== parent) {
      if (parent.$vnode && parent.$vnode.data.routerView) {
        depth++
      }
      if (parent._inactive) {
        inactive = true
      }
      parent = parent.$parent
    }
    const routerViewDepth = depth

    let currentCache = null

    const matched = route.matched[depth]
    if (matched) {
      // Get effective route (with instantiated url params) as key
      let key = matched.path
      if (props.forceMultiViews) {
        key = getEffectiveRoute(matched.path, route)
      }
      const cache = bigCache[key] || (bigCache[key] = {})

      // render previous view if the tree is inactive and kept-alive
      if (inactive) {
        currentCache = cache[name]
      } else {
        const cached = cache[name] || (cache[name] = {
          component: null,
          data: {},
          name: matched.name,
          active: undefined,
        })
        currentCache = cached
        cached.component = matched.components[name]
      }
    }

    const finalChildren = []

    Object.keys(bigCache).forEach(key => {
      const cached = bigCache[key][name]
      if (cached && cached.component) {
        const isCurrent = cached === currentCache

        const data = {
          ...cached.data,
          routerView: true,
          routerViewDepth: routerViewDepth,
          key: key,
          attrs: {
            'data-route-path': key,
            'data-route-name': cached.name,
            'data-is-active': isCurrent ? true : null,
          },
          keepAlive: true,
          directives: [
            {
              name: 'show',
              value: isCurrent,
            },
          ],
        }

        if (isCurrent) {
          const matched = route.matched[depth]

          // attach instance registration hook
          // this will be called in the instance's injected lifecycle hooks
          data.registerRouteInstance = (vm, val) => {
            // val could be undefined for unregistration
            const current = matched.instances[name]
            if (
              (val && current !== vm) ||
              (!val && current === vm)
            ) {
              matched.instances[name] = val
            }
          }

          // resolve props
          let propsToPass = data.props = resolveProps(route, matched.props && matched.props[name])
          if (propsToPass) {
            // clone to prevent mutation
            propsToPass = data.props = extend({}, propsToPass)
            // pass non-declared props as attrs
            const attrs = data.attrs = data.attrs || {}
            for (const key in propsToPass) {
              if (!cached.component.props || !(key in cached.component.props)) {
                attrs[key] = propsToPass[key]
                delete propsToPass[key]
              }
            }
          }
        }

        // also register instance in prepatch hook
        // in case the same component instance is reused across different routes
        // (and prevent override of prepatch hook)
        const hook = {
          ...data.hook || {},
          _prepatch: null,
        }
        data.hook = hook
        const originalPrepatch = hook.prepatch
        const prepatch = (oldVnode, vnode) => {
          originalPrepatch && originalPrepatch(oldVnode, vnode)
          hook._prepatch && hook._prepatch(oldVnode, vnode)
          if (isCurrent) {
            matched.instances[name] = vnode.componentInstance
          }
          updateActive(isCurrent, cached, vnode.componentInstance)
        }
        Object.defineProperty(hook, 'prepatch', {
          get: () => prepatch,
          set: value => hook._prepatch = value,
        })

        cached.data = data

        finalChildren.push(h(cached.component, data))
      }
    })

    children && finalChildren.push(...children)

    return h(props.morph, data, finalChildren)
  },
}

function resolveProps (route, config) {
  switch (typeof config) {
    case 'undefined':
      return
    case 'object':
      return config
    case 'function':
      return config(route)
    case 'boolean':
      return config ? route.params : undefined
    default:
      if (process.env.NODE_ENV !== 'production') {
        warn(
          false,
          `props in '${route.path}' is a ${typeof config}, ` +
          `expecting an object, function or boolean.`
        )
      }
  }
}

function extend (to, from) {
  for (const key in from) {
    to[key] = from[key]
  }
  return to
}
