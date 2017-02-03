import {NodeArray} from "./NodeArray";
import {ComponentOptions} from "./ComponentOptions";
import {NodeUtils} from "../utils/NodeUtils";
import {StringUtils} from "../utils/StringUtils";

export class Component extends HTMLElement {

    private static registeredAttributes = new Map();

    private slotChildren:NodeArray;

    private variableUpdateCallbacks = new Map();
    private bindMapIndex = new Map();
    private bindMap = new Map();

    public static registerAttribute(attribute:Function, name?: string) {
        if(!name) {
            name = StringUtils.toDashed(attribute.name);
        }
        this.registeredAttributes.set(name, attribute);
    }

    constructor(options:ComponentOptions) {
        super();

        new Promise((resolve, reject) => {
            if(options.template !== undefined) {
                resolve(options.template);
            } else if (options.templateUrl !== undefined) {

                fetch(options.templateUrl)
                    .then(response => {
                        if(response.ok) {
                            return response.text();
                        } else {
                            reject(new TypeError(response.status + " " + response.statusText));
                        }
                    }).then(templateText => {
                        resolve(templateText);
                    }).catch(error => {
                        reject(error);
                    });
            } else {
                resolve();
            }
        }).then((template) => {
            if(template !== undefined) {
                let slotChildrenHolder = document.createElement("div");
                while (this.firstChild) {
                    slotChildrenHolder.appendChild(this.firstChild);
                }
                this.slotChildren = new NodeArray(slotChildrenHolder.childNodes);
                if(options.shadowContent === true) {
                    this.attachShadow({"mode": "open"});
                }
                this.innerHTML += template;
            }

            this.updateBindings(this);
            this.created();
        }).catch((error) => {
            if(error instanceof TypeError) {
                //noinspection TypeScriptUnresolvedVariable
                error = error.stack;
            }
            console.error("Failed to initialize component %o", this, error);
        });
    }

    /* Can be overwritten, is called by constructor */
    protected created():void {

    }

    /* Can be overwritten, is called by triggerUpdateCallbacks */
    protected update(variableName:string):void {

    }

    public getSlotChildren():NodeArray {
        return this.slotChildren;
    }

    public addUpdateCallback(variableName:string, callback:(variableName:string) => void):Component {
        if(!this.variableUpdateCallbacks.has(variableName)) {
            this.variableUpdateCallbacks.set(variableName, []);
        }
        let updateCallbacks = this.variableUpdateCallbacks.get(variableName);
        updateCallbacks[updateCallbacks.length] = callback;

        this.buildSetterVariable(variableName);

        return this;
    }

    public removeUpdateCallback(variableName:string, callback:(variableName:string) => void):Component {
        let updateCallbacks = this.variableUpdateCallbacks.get(variableName);
        updateCallbacks.splice(updateCallbacks.indexOf(callback), 1);
        return this;
    }

    public updateBindings(startElement:Element):void {
        this.evaluateAttributeHandlers(startElement);

        if(this.bindMapIndex.has(startElement)) { // if node was already evaluated

            if(!NodeUtils.isNodeChildOf(this, startElement)) { // If not a child of the component anymore, remove from bindMap
                let bindMapKeys = this.bindMapIndex.get(startElement);
                for(let bindMapKey of bindMapKeys) {
                    let bindMap = this.bindMap.get(bindMapKey);
                    for(let i = 0, length = bindMap.length; i < length; i++) {
                        if(bindMap[i][0] === startElement) {
                            bindMap.splice(i, 1);
                        }
                    }
                }
                this.bindMapIndex.delete(startElement);
            }
        } else if(NodeUtils.isNodeChildOf(this, startElement)) { // If this node is not already bound
            NodeUtils.recurseTextNodes(startElement, (node, text) => {
                this.setupBindMapForNode(node, text);
            });
        }

        let nodeList = startElement.childNodes;
        for (let i = 0, node; node = nodeList[i]; i++) {
            this.updateBindings(node);
        }
    }



    private evaluateAttributeHandlers(startElement:Element):void { // Creates instances of specific attribute classes into the attribute node itself.
        if(startElement.attributes !== undefined) {
            for (let j = 0, attributeNode; attributeNode = startElement.attributes[j]; j++) {
                if(Component.registeredAttributes.has(attributeNode.name) && attributeNode._alloyAttribute === undefined) {
                    attributeNode._alloyComponent = this;
                    attributeNode._alloyAttribute = new (Component.registeredAttributes.get(attributeNode.name))(attributeNode);
                }
            }
        }
        let nodeList = startElement.childNodes;
        for (let i = 0, node; node = nodeList[i]; i++) {
            this.evaluateAttributeHandlers(node);
        }
    }

    // TODO: Performance save evaluated function objects in the bind mapping and just call these instead of evaluating the functions with every update
    private setupBindMapForNode(node:Node, text:string):void {
        let alreadyBoundForNode = new Set();
        this.callForVariablesInText(text, (variables) => {
            for(let variableName of variables) {
                if(!alreadyBoundForNode.has(variableName)) {
                    alreadyBoundForNode.add(variableName);
                    if (!this.bindMap.has(variableName)) {
                        this.bindMap.set(variableName, []);
                    }
                    let bindAttributes = this.bindMap.get(variableName);
                    bindAttributes.push([node, text, variables]);

                    if(!this.bindMapIndex.has(node)) {
                        this.bindMapIndex.set(node, new Set());
                    }
                    let bindMapIndexEntries = this.bindMapIndex.get(node);
                    bindMapIndexEntries.add(variableName);

                    if (Object.getOwnPropertyDescriptor(this, variableName) === undefined || Object.getOwnPropertyDescriptor(this, variableName).set === undefined) {
                        this.buildSetterVariable(variableName);
                    }
                }
            }
        });
    }

    private evalMatchRegExp = /\${([^}]*)}/g;
    private variablesRegExp = /\s*this\.([a-zA-Z0-9_$]+)\s*/g;
    private callForVariablesInText(text:string, callback:(variables:Set<string>) => void):void {
        let evalMatch;
        this.evalMatchRegExp.lastIndex = 0; // Reset the RegExp, better performance than recreating it every time
        while (evalMatch = this.evalMatchRegExp.exec(text)) {
            let variableMatch;
            this.variablesRegExp.lastIndex = 0; // Reset the RegExp, better performance than recreating it every time

            let variables = new Set();
            while (variableMatch = this.variablesRegExp.exec(evalMatch[1])) {
                variables.add(variableMatch[1]);
            }

            callback(variables);
        }
    }

    private buildSetterVariable(variableName:string):void {
        if(this.hasOwnProperty(variableName)) return;

        this["__" + variableName] = this[variableName];
        Object.defineProperty(this, variableName, {
            get: () => {
                return this["__" + variableName];
            },
            set: (newValue:any) => {
                if(newValue !== undefined && newValue !== null && newValue.constructor === Object || newValue instanceof Array) {
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
                                this.triggerUpdateCallbacks(variableName);
                            }
                            return true;
                        }
                    };
                    newValue = new Proxy(newValue, proxyTemplate);
                }
                if(this["__" + variableName] !== newValue) {
                    this["__" + variableName] = newValue;
                    this.triggerUpdateCallbacks(variableName);
                }
            }
        });
    }

    private updateDom(variableName:string):void {
        if(!this.bindMap.has(variableName)) return;

        for(let value of this.bindMap.get(variableName)) { // Loop through all nodes in which the variable that triggered the update is used in
            let nodeToUpdate = value[0]; // The node in which the variable that triggered the update is in, the text can already be overwritten by the evaluation of evalText
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
    }

    private triggerUpdateCallbacks(variableName:string):void {
        if(this.variableUpdateCallbacks.has(variableName)) {
            let updateCallbacks = this.variableUpdateCallbacks.get(variableName);
            for(let i = 0, length = updateCallbacks.length; i < length; i++) {
                updateCallbacks[i](variableName);
            }
        }
        this.update(variableName);
        this.updateDom(variableName);
    }

}