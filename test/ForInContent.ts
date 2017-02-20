import * as Alloy from "../src/Alloy"

@Alloy.component()
export class ForInContent extends Alloy.Component {

    private entries:Number[] = [];

    constructor() {
        super({
            template: "<div for='let key in this.entries'><b>${this.entries[key]}</b><br>${this.entries[key]}</div>"
        });
    }

    created() {
        let self = this;
        self.entries = [1, 2, 3, 4];

        window["test"] = this;
    }

}