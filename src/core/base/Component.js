import XHRProvider from "./../utils/data-providers/XHRProvider";
import Alloy from "../Alloy";
import NodeArray from "./../utils/NodeArray";

const _triggerUpdateCallbacks = function(variableName) {
    if(this._variableUpdateCallbacks.has(variableName)) {
        let updateCallbacks = this._variableUpdateCallbacks.get(variableName);
        for(let i = 0, length = updateCallbacks.length; i < length; i++) {
            updateCallbacks[i](variableName);
        }
    }
    _update.call(this, variableName);
    if(this.update instanceof Function) {
        this.update(variableName);
    }
};

const _buildSetterVariable = function(variableName) {
    if(this.hasOwnProperty(variableName)) return;

    this["__" + variableName] = this[variableName];
    Object.defineProperty(this, variableName, {
        get: () => {
            return this["__" + variableName];
        },
        set: (newValue) => {
            if(newValue.constructor === Object || newValue instanceof Array) {
                const proxyTemplate = {
                    get: (target, property) => {
                        return target[property];
                    },
                    set: (target, property, value) => {
                        if(value instanceof Object) {
                            value = new Proxy(value, proxyTemplate);
                        }
                        if(target[property] !== value) {
                            target[property] = value;
                            _triggerUpdateCallbacks.call(this, variableName);
                        }
                        return true;
                    }
                };
                newValue = new Proxy(newValue, proxyTemplate);
            }
            if(this["__" + variableName] !== newValue) {
                this["__" + variableName] = newValue;
                _triggerUpdateCallbacks.call(this, variableName);
            }
        }
    });
};


const evalMatchRegExp = /\${([^}]*)}/g;
const variablesRegExp = /\s*this\.([a-zA-Z0-9_$]+)\s*/g;
const _callForVariablesInText = function(text, callback) {
    let evalMatch;
    evalMatchRegExp.lastIndex = 0; // Reset the RegExp, better performance than recreating it every time
    while (evalMatch = evalMatchRegExp.exec(text)) {
        let variableMatch;
        variablesRegExp.lastIndex = 0; // Reset the RegExp, better performance than recreating it every time

        let variables = new Set();
        while (variableMatch = variablesRegExp.exec(evalMatch[1])) {
            variables.add(variableMatch[1]);
        }

        callback(variables);
    }
};

const _recurseTextNodes = function(startNode, callback) {
    if(startNode instanceof CharacterData && startNode.textContent !== "") {
        callback.call(this, startNode, startNode.textContent);
    }
    if(startNode.attributes !== undefined) {
        for (let j = 0, attributeNode; attributeNode = startNode.attributes[j]; j++) {
            if(attributeNode.value != "") {
                callback.call(this, attributeNode, attributeNode.value);
            }
        }
    }

    let nodeList = startNode.childNodes;
    for (let i = 0, node; node = nodeList[i]; i++) {
        if (!(node instanceof CharacterData)) {
            continue;
        }
        _recurseTextNodes.call(this, node, callback);
    }
};

// TODO: Performance save evaluated function objects in the bind mapping and just call these instead of evaluating the functions with every update
const _setupBindMapForNode = function(node, text) {
    let alreadyBoundForNode = new Set();
    _callForVariablesInText(text, (variables) => {
        for(let variableName of variables){
            if(!alreadyBoundForNode.has(variableName)) {
                alreadyBoundForNode.add(variableName);
                if (!this._bindMap.has(variableName)) {
                    this._bindMap.set(variableName, []);
                }
                let bindAttributes = this._bindMap.get(variableName);
                bindAttributes.push([node, text, variables]);

                if(!this._bindMapIndex.has(node)) {
                    this._bindMapIndex.set(node, new Set());
                }
                let bindMapIndexEntries = this._bindMapIndex.get(node);
                bindMapIndexEntries.add(variableName);

                if (Object.getOwnPropertyDescriptor(this, variableName) === undefined || Object.getOwnPropertyDescriptor(this, variableName).set === undefined) {
                    _buildSetterVariable.call(this, variableName);
                }
            }
        }
    });
};

const _evaluateAttributeHandlers = function(startNode) { // Creates instances of specific attribute classes into the attribute node itself.
    if(startNode.attributes !== undefined) {
        for (let j = 0, attributeNode; attributeNode = startNode.attributes[j]; j++) {
            if(Alloy._registeredAttributes.has(attributeNode.name) && attributeNode._alloyAttribute === undefined) {
                attributeNode._alloyComponent = this;
                attributeNode._alloyAttribute = new (Alloy._registeredAttributes.get(attributeNode.name))(attributeNode);
            }
        }
    }
    let nodeList = startNode.childNodes;
    for (let i = 0, node; node = nodeList[i]; i++) {
        _evaluateAttributeHandlers.call(this, node);
    }
};

const _update = function(variableName) {
    if(!this._bindMap.has(variableName)) return;

    for(let value of this._bindMap.get(variableName)) { // Loop through all nodes in which the variable that triggered the update is used in
        let nodeToUpdate = value[0]; // The node in which the variable that triggered the update is in, the text can already be overritten by the evaluation of evalText
        let evalText = value[1]; // Could contain multiple variables, but always the variable that triggered the update which is variableName

        // Convert the nodeToUpdate to a non TextNode Node
        let htmlNodeToUpdate;
        if(nodeToUpdate instanceof CharacterData) {
            htmlNodeToUpdate = nodeToUpdate.parentElement;
        } else if(nodeToUpdate instanceof Attr) {
            htmlNodeToUpdate = nodeToUpdate.ownerElement;
        } else {
            htmlNodeToUpdate = nodeToUpdate;
        }

        if(htmlNodeToUpdate.parentElement === null) continue; // Skip nodes that are not added to the visible dom

        for(let variablesVariableName of value[2]) {
            if(this[variablesVariableName] instanceof NodeArray || this[variablesVariableName] instanceof HTMLElement) {
                evalText = evalText.replace(new RegExp("\\${\\s*this\\." + variablesVariableName + "\\s*}", "g"), ""); // Remove already as node identified and evaluated variables from evalText
                if(variableName === variablesVariableName) {
                    if(this[variablesVariableName] instanceof NodeArray) {
                        for(let i = 0, length = this[variablesVariableName].length; i < length; i++) {
                            let node = this[variablesVariableName][i];
                            htmlNodeToUpdate.appendChild(node);
                        }
                    } else {
                        htmlNodeToUpdate.appendChild(this[variablesVariableName]);
                    }
                }
            }
        }

        if(!(nodeToUpdate instanceof HTMLElement)) {
            let evaluated;
            try {
                let variableDeclarationString = "";
                for(let declaredVariableName in htmlNodeToUpdate._variables) { // no need to check for hasOwnProperty, cause of Object.create(null)
                    //noinspection JSUnfilteredForInLoop
                    variableDeclarationString += "let " + declaredVariableName + "=" + JSON.stringify(htmlNodeToUpdate._variables[declaredVariableName])+";";
                }
                evaluated = eval(variableDeclarationString + "`" + evalText + "`");
            } catch(error) {
                console.error(error, evalText, "on node", nodeToUpdate);
            }
            if (nodeToUpdate instanceof CharacterData) {
                nodeToUpdate.textContent = evaluated;
            } else {
                nodeToUpdate.value = evaluated;
            }
        }
    }
};

const _isNodeChildOf = function(parent, child) {
    if(child.parentElement === parent) {
        return true;
    }
    if(child.parentElement === null || child.parentElement === document.body) {
        return false;
    }
    return _isNodeChildOf(parent, child.parentElement);
};

let _instances = new Map();

//noinspection JSUnusedLocalSymbols
export default class Component {

    //noinspection JSUnusedGlobalSymbols
    static getInstance(elementId) {
        return _instances.get(elementId);
    }

    constructor(rootNode, options) {
        this._rootNode = rootNode;
        options.templateMethod = options.templateMethod === undefined ? "auto" : options.templateMethod;

        new Promise((resolve, reject) => {
            if(options.templateMethod === "inline") {
                resolve(options.template);
            } else if (options.templateMethod === "children") {
                resolve();
            } else {
                XHRProvider.load(options.template, null, {cache: options.cache, version: options.version}).then((template) => {
                    resolve(template);
                }).catch((error) => {
                    reject(error);
                });
            }
        }).then((template) => {
            if(template !== undefined) {
                this._transcludedChildren = document.createElement("div");
                while (this._rootNode.firstChild) {
                    this._transcludedChildren.appendChild(this._rootNode.firstChild);
                }
                this._transcludedChildren = new NodeArray(this._transcludedChildren.childNodes);
                this._rootNode.innerHTML += template;
            }

            this._variableUpdateCallbacks = new Map();
            this._bindMapIndex = new Map();
            this._bindMap = new Map();
            //this._bindMap = _buildBindMap.call(this, this._rootNode);
            //_evaluateAttributeHandlers.call(this, this._rootNode);
            this.updateBindings(this._rootNode);

            if(this.attached instanceof Function) {
                this.attached();
            }

            if(this._rootNode.attributes.id !== undefined) {
                _instances.set(this._rootNode.attributes.id.value, this);
            }
        }).catch((error) => {
            if(error instanceof Error) {
                //noinspection JSUnresolvedVariable
                error = error.stack;
            }
            console.error("Failed to initialize component %o", this, error);
        });
    }

    _destructor() {
        //noinspection JSUnresolvedVariable
        if(this.destructor instanceof Function) {
            //noinspection JSUnresolvedFunction
            this.destructor();
        }

        if(this._rootNode.attributes.id !== undefined && _instances.has(this._rootNode.attributes.id.value)) {
            _instances.delete(this._rootNode.attributes.id.value);
        }
    }

    //noinspection JSUnusedGlobalSymbols
    getAttributes() {
        return this._rootNode.attributes;
    }

    //noinspection JSUnusedGlobalSymbols
    getAttributeValue(name) {
        return this._rootNode.attributes.getNamedItem(name).nodeValue;
    }

    getTranscludedChildren() {
        return this._transcludedChildren;
    }

    addUpdateCallback(variableName, callback) {
        if(!this._variableUpdateCallbacks.has(variableName)) {
            this._variableUpdateCallbacks.set(variableName, []);
        }
        let updateCallbacks = this._variableUpdateCallbacks.get(variableName);
        updateCallbacks[updateCallbacks.length] = callback;

        _buildSetterVariable.call(this, variableName);
    }

    //noinspection JSUnusedGlobalSymbols
    removeUpdateCallback(variableName, callback) {
        let updateCallbacks = this._variableUpdateCallbacks.get(variableName);
        updateCallbacks.splice(updateCallbacks.indexOf(callback), 1);
    }

    updateBindings(startNode) {
        _evaluateAttributeHandlers.call(this, startNode);

        if(this._bindMapIndex.has(startNode)) { // if node was already evaluated

            if(!_isNodeChildOf(this._rootNode, startNode)) { // If not a child of the component anymore, remove from bindMap
                let bindMapKeys = this._bindMapIndex.get(startNode);
                for(let bindMapKey of bindMapKeys) {
                    let bindMap = this._bindMap.get(bindMapKey);
                    for(let i = 0, length = bindMap.length; i < length; i++) {
                        if(bindMap[i][0] === startNode) {
                            bindMap.splice(i, 1);
                        }
                    }
                }
                this._bindMapIndex.delete(startNode);
            }
        } else if(_isNodeChildOf(this._rootNode, startNode)) { // If this node is not already bound
            _recurseTextNodes.call(this, startNode, (node, text) => {
                _setupBindMapForNode.call(this, node, text);
            });
        }

        let nodeList = startNode.childNodes;
        for (let i = 0, node; node = nodeList[i]; i++) {
            this.updateBindings(node);
        }
    }

    cloneNode(component) {
        let rootNode = document.createElement("div");
        let transcludedChildren = this.getTranscludedChildren();
        for(let child of transcludedChildren) {
            rootNode.appendChild(child.cloneNode(true));
        }

        let holderNode = document.createElement("div");
        holderNode.innerHTML = "<"+component.name+">" + rootNode.innerHTML + "</"+component.name+">"; // TODO: add the attributes here...

        return holderNode.childNodes[0];
    }

}