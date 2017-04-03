import * as Alloy from "../../src/Alloy"

@Alloy.component()
export class ForInTemplate extends Alloy.Component {

    private entries:Number[] = [];

    constructor() {
        super({
            template: "<div loop-for='let key in this.entries'><b>${this.entries[key]}</b>${this.entries[key]}</div>"
        });

        this.created.then(() => {
            let self = this;
            self.entries = [1, 2, 3, 4];

            window["test"] = this;
        });
    }

}